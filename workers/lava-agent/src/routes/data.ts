/**
 * Read-only data endpoints, backed by Neon over HTTP.
 *
 * Every handler returns a Response or `null` when the path is not its own, so
 * the dispatcher can try each module in turn. Validation failures throw
 * ApiError (400/404); anything unexpected propagates to the dispatcher, which
 * logs it with a request id and returns a generic 500.
 */
import type { Env } from "../db";
import { db } from "../db";
import { CONF_SQL, CONF_SQL_FINDING, DERIVED_DATASET_SQL } from "../confidence";
import { badRequest, json, notFound } from "../http";
import { numify, numifyOne } from "../serialize";
import { derivePsiMetrics } from "../psiMetrics";
import {
  embedSafe, heuristicGrade, hybridSearch, keywordSearch, mergePsi, mmrDiversify, RANK_WEIGHTS,
  relevanceGate, rerank, retrieve, retrievalQuery, SI_WEIGHT, siRerank, smartRank,
} from "../retrieval";

const STATS_KEYS = [
  "documents", "documents_with_fulltext", "chunks", "embeddings",
  "experiments", "findings", "findings_outcomes", "findings_conditions",
  "findings_statements", "findings_verified", "insights", "corpus_words",
  "corpus_chars", "artifact_bytes",
];

/** Cap on rows returned for any one PSI table (largest fetched table is 469). */
const PSI_ROW_LIMIT = 500;

/**
 * Derive the vector-coverage ratio the UI reports, so the number is computed
 * from the live counts rather than asserted. Vector indexing depends on an
 * embedding backend that can be rate-limited or out of quota, so coverage is
 * expected to be below 1 and the UI must be able to say so honestly.
 */
function embeddingCoverage(stats: any): { embedding_coverage: number; vectors_complete: boolean } {
  const chunks = Number(stats?.chunks ?? 0);
  const embeddings = Number(stats?.embeddings ?? 0);
  const ratio = chunks > 0 ? Math.min(1, embeddings / chunks) : 0;
  return { embedding_coverage: Math.round(ratio * 1000) / 1000, vectors_complete: chunks > 0 && embeddings >= chunks };
}

/** Every PSI publication the experiment links to, with its tables and rows. */
async function psiForExperiment(sql: any, experiment: any) {
  const links: any[] = await sql`SELECT investigation_id, relation FROM ignis.psi_experiment_link WHERE experiment_id = ${experiment.id}`;
  const ids = new Set<string>(links.map((l) => String(l.investigation_id)));
  if (experiment.psi_investigation_id) ids.add(String(experiment.psi_investigation_id));
  if (!ids.size) return { investigations: [], summary: null };
  const invIds = [...ids];
  const invRows: any[] = await sql`
    SELECT id, version, doi, license, title, acronym, research_area, sub_area, url,
           project_type, flight_platform, managing_center, start_date, end_date
      FROM ignis.psi_investigation WHERE id = ANY(${invIds}::text[]) ORDER BY id`;
  const tables: any[] = await sql`
    SELECT id, investigation_id, investigation_version, doi, license, title,
           file_name, row_count, columns
      FROM ignis.psi_experiment_table
     WHERE investigation_id = ANY(${invIds}::text[])
     ORDER BY investigation_id, file_name`;
  const investigations = [];
  for (const inv of invRows) {
    const invTables = [];
    for (const t of tables.filter((t2) => t2.investigation_id === inv.id)) {
      const rows: any[] = await sql`
        SELECT row_index, test_id, test_date, data
          FROM ignis.psi_test_row WHERE table_id = ${t.id}
         ORDER BY row_index LIMIT ${PSI_ROW_LIMIT}`;
      invTables.push({
        id: t.id,
        investigation_id: t.investigation_id,
        title: t.title,
        file_name: t.file_name,
        doi: t.doi,
        license: t.license,
        row_count: Number(t.row_count),
        columns: t.columns,
        rows: rows.map((r) => ({
          ...r.data ?? {},
          __index: Number(r.row_index),
          __test_id: r.test_id,
          __test_date: r.test_date,
        })),
      });
    }
    investigations.push({ ...inv, tables: invTables });
  }
  const totalRows = tables.reduce((a, t) => a + Number(t.row_count || 0), 0);
  return {
    investigations,
    summary: { investigations: invRows.length, tables: tables.length, rows: totalRows },
  };
}

export async function handleDataRoutes(request: Request, url: URL, env: Env): Promise<Response | null> {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/health") {
    const started = Date.now();
    try {
      const sql = db(env);
      const rows: any[] = await sql`SELECT * FROM ignis.document_stats`;
      const stats = numifyOne(rows[0], STATS_KEYS);
      return json({
        status: "ok",
        backend: "live-worker",
        server_time: new Date().toISOString(),
        latency_ms: Date.now() - started,
        stats: { ...stats, ...embeddingCoverage(stats) },
      });
    } catch {
      return json({ status: "error", backend: "live-worker" }, 503);
    }
  }

  if (request.method === "GET" && pathname === "/stats") {
    const sql = db(env);
    const [stats, byKind, byYear, topDocs, topMetrics, pipeline] = await Promise.all([
      sql`SELECT * FROM ignis.document_stats`,
      sql`SELECT kind, count(*)::int AS n FROM ignis.document GROUP BY kind ORDER BY n DESC`,
      sql`SELECT extract(year FROM published_date)::int AS year, count(*)::int AS n FROM ignis.document WHERE published_date IS NOT NULL GROUP BY 1 ORDER BY 1`,
      sql`SELECT d.id, d.source_id, d.title, d.kind, d.word_count, d.quality_score, d.published_date, d.landing_url, (SELECT count(*)::int FROM ignis.chunk c WHERE c.document_id = d.id) AS chunks FROM ignis.document d ORDER BY d.quality_score DESC NULLS LAST LIMIT 12`,
      sql`SELECT metric, count(*)::int AS n, round(min(value)::numeric,3) AS min_value, round(max(value)::numeric,3) AS max_value, mode() WITHIN GROUP (ORDER BY unit) AS unit FROM ignis.dataset_row GROUP BY metric ORDER BY n DESC LIMIT 40`,
      sql`SELECT stage, status, items_in, items_out, bytes_in, started_at, finished_at FROM ignis.pipeline_run ORDER BY id DESC LIMIT 10`,
    ]);
    return json({
      stats: numifyOne(stats[0], STATS_KEYS),
      byKind: numify(byKind, ["n"]),
      byYear: numify(byYear, ["year", "n"]),
      topDocs: numify(topDocs, ["word_count", "quality_score", "chunks"]),
      topMetrics: numify(topMetrics, ["n", "min_value", "max_value"]),
      pipeline: numify(pipeline, ["items_in", "items_out", "bytes_in"]),
    });
  }

  if (request.method === "GET" && pathname === "/experiments") {
    const sql = db(env);
    const [experiments, facilities] = await Promise.all([
      sql`SELECT e.id, e.code, e.name, e.campaign, e.status, e.gravity_level, e.fuel_type, e.sample_geometry, e.fuel_thickness, e.ambient_gas, e.flow_velocity, e.flow_velocity_unit, e.o2_fraction, e.pressure_kpa, e.objective, e.summary, e.aliases, e.psi_investigation_id, e.psi_version, e.psi_doi, e.psi_url, e.psi_status, f.code AS facility, f.name AS facility_name, f.platform, (SELECT count(*)::int FROM ignis.experiment_document ed WHERE ed.experiment_id = e.id) AS documents, (SELECT count(DISTINCT fi.id)::int FROM ignis.finding fi JOIN ignis.experiment_document ed ON ed.document_id = fi.document_id WHERE ed.experiment_id = e.id) AS findings FROM ignis.experiment e LEFT JOIN ignis.facility f ON f.id = e.facility_id ORDER BY documents DESC, e.code`,
      sql`SELECT f.id, f.code, f.name, f.platform, f.agency, f.g_level, f.description, (SELECT count(*)::int FROM ignis.experiment e WHERE e.facility_id = f.id) AS experiments FROM ignis.facility f ORDER BY f.code`,
    ]);
    return json({
      experiments: numify(experiments, ["o2_fraction", "pressure_kpa", "fuel_thickness", "flow_velocity", "documents", "findings"]),
      facilities: numify(facilities, ["experiments"]),
    });
  }

  if (request.method === "GET" && pathname === "/insights") {
    const sql = db(env);
    const [insights, metrics, coverage] = await Promise.all([
      sql`SELECT id, slug, title, body, category, severity, confidence, supporting_documents, generated_by, created_at FROM ignis.insight ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, confidence DESC`,
      sql`SELECT metric, count(*)::int AS n, round(min(value)::numeric,3) AS min_value, round(max(value)::numeric,3) AS max_value, round(avg(value)::numeric,3) AS avg_value, mode() WITHIN GROUP (ORDER BY unit) AS unit FROM ignis.dataset_row GROUP BY metric ORDER BY n DESC`,
      sql`SELECT e.code, e.name, e.campaign, count(DISTINCT ed.document_id)::int AS documents FROM ignis.experiment e LEFT JOIN ignis.experiment_document ed ON ed.experiment_id = e.id GROUP BY e.code, e.name, e.campaign ORDER BY documents ASC`,
    ]);
    // `supporting_documents` is a bare bigint[] of document ids; the UI renders
    // a citation per source, so resolve each id to its title and link here.
    const docIds = [
      ...new Set(
        insights.flatMap((i: any) =>
          (Array.isArray(i.supporting_documents) ? i.supporting_documents : []).map((d: any) => Number(d)),
        ),
      ),
    ].filter((n) => Number.isFinite(n));
    const docs = docIds.length
      ? await sql`SELECT id, source_id, title, landing_url FROM ignis.document WHERE id = ANY(${docIds}::bigint[])`
      : [];
    const byId = new Map(docs.map((d: any) => [Number(d.id), d]));
    const withDocs = insights.map((i: any) => ({
      ...i,
      supporting_documents: (Array.isArray(i.supporting_documents) ? i.supporting_documents : [])
        .map((d: any) => byId.get(Number(d)))
        .filter(Boolean),
    }));
    return json({
      insights: numify(withDocs, ["confidence"]),
      metrics: numify(metrics, ["n", "min_value", "max_value", "avg_value"]),
      coverage: numify(coverage, ["documents"]),
    });
  }

  // Coverage map: the empirical envelope of the corpus per variable, so the UI
  // can shade "no direct evidence" instead of implying a prediction. Only
  // machine-extracted candidates feed it, so every band carries the caveat.
  if (request.method === "GET" && pathname === "/coverage") {
    const sql = db(env);
    // Each variable carries the units the corpus records it in, and how to map
    // each onto the canonical unit shown. A value in a unit we cannot convert
    // is dropped rather than mixed in silently.
    const metrics: { key: string; label: string; unit: string; from: Record<string, number> }[] = [
      { key: "oxygen", label: "Oxygen concentration", unit: "%", from: { "vol%": 1, "%": 1, "mole fraction": 100 } },
      { key: "limiting_oxygen", label: "Limiting oxygen index", unit: "%", from: { "%": 1, "vol%": 1 } },
      { key: "flow", label: "Flow velocity", unit: "cm/s", from: { "cm/s": 1, "mm/s": 0.1, "m/s": 100 } },
      { key: "pressure", label: "Pressure", unit: "atm", from: { atm: 1, kPa: 1 / 101.325, MPa: 1000 / 101.325, bar: 100 / 101.325 } },
      { key: "gravity", label: "Gravity level", unit: "g", from: { g: 1, "m/s²": 1 / 9.80665, "m/s^2": 1 / 9.80665 } },
    ];
    const rows: any[] = await sql`
      SELECT metric, value, unit, confidence, document_id, role
        FROM ignis.dataset_row
       WHERE value IS NOT NULL AND unit IS NOT NULL
         AND metric = ANY(${metrics.map((m) => m.label.toLowerCase())})`;
    const perMetric = new Map<string, any[]>();
    for (const r of rows) {
      const arr = perMetric.get(r.metric) || [];
      arr.push(r);
      perMetric.set(r.metric, arr);
    }
    const summary = metrics.map((m) => {
      const hits = perMetric.get(m.label.toLowerCase()) || [];
      const factor = m.from as Record<string, number>;
      const onUnit = hits
        .map((h) => ({ v: Number(h.value) * (factor[String(h.unit)] ?? NaN), d: h.document_id, u: String(h.unit) }))
        .filter((x) => Number.isFinite(x.v));
      const norm = onUnit.map((x) => x.v).filter((v) => Number.isFinite(v));
      const sorted = [...norm].sort((a, b) => a - b);
      // An inner band (10th-90th percentile) so a couple of extraction
      // outliers cannot stretch the "tested range" across the whole axis; the
      // true min/max are still reported as the outer extent.
      const q = (p: number) =>
        sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] : null;
      const r3 = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 1000);
      const roles = [...new Set(hits.map((h) => String(h.role)))].sort();
      return {
        key: m.key,
        label: m.label,
        unit: m.unit,
        role: roles.length === 1 ? roles[0] : roles.join("/"),
        n: norm.length,
        documents: new Set(onUnit.map((x) => x.d)).size,
        min: r3(sorted.length ? sorted[0] : null),
        max: r3(sorted.length ? sorted[sorted.length - 1] : null),
        band_lo: r3(q(0.1)),
        band_hi: r3(q(0.9)),
        median: r3(q(0.5)),
        // Every value here is a regex-extracted candidate, never hand-verified.
        verified: 0,
      };
    });
    return json({
      generated_at: new Date().toISOString(),
      note: "Empirical envelope of machine-extracted candidate values. Conditions and outcomes are separated and only role-bearing rows are counted; nothing here is hand-verified, and absence of a value is not evidence of absence. PSI holds no direct partial-gravity combustion data, so the gravity band is a platform condition, not partial-gravity coverage.",
      variables: summary,
    });
  }

  const expMatch = pathname.match(/^\/experiments\/([^/]+)$/);
  if (request.method === "GET" && expMatch) {
    const sql = db(env);
    const code = decodeURIComponent(expMatch[1]);
    const rows: any[] = await sql`SELECT e.*, f.code AS facility, f.name AS facility_name, f.platform, f.g_level FROM ignis.experiment e LEFT JOIN ignis.facility f ON f.id = e.facility_id WHERE lower(e.code) = lower(${code}) OR ${code} = ANY(e.aliases) LIMIT 1`;
    if (!rows.length) throw notFound(`experiment ${code} not found`);
    const experiment = rows[0];
    const documents: any[] = await sql`SELECT d.id, d.source_id, d.title, d.kind, d.published_date, d.word_count, d.quality_score, d.landing_url, ed.relation FROM ignis.experiment_document ed JOIN ignis.document d ON d.id = ed.document_id WHERE ed.experiment_id = ${experiment.id} ORDER BY d.quality_score DESC NULLS LAST LIMIT 50`;
    const findings: any[] = await sql.query(
      `SELECT f.id, f.metric, f.value, f.value_max, f.unit, f.statement,
              ${CONF_SQL_FINDING} AS confidence, f.evidence_quote, f.document_id, f.role,
              f.review_status, f.source_layer
         FROM ignis.finding f
         JOIN ignis.experiment_document ed ON ed.document_id = f.document_id
        WHERE ed.experiment_id = $1 ORDER BY f.metric, f.value LIMIT 200`,
      [experiment.id]) as any[];
    const psi = await psiForExperiment(sql, experiment);
    const psiMetrics = derivePsiMetrics(
      psi.investigations.flatMap((inv: any) => inv.tables ?? []),
    );
    return json({
      experiment: numifyOne(experiment, ["o2_fraction", "pressure_kpa", "documents", "findings"]),
      documents: numify(documents, ["word_count", "quality_score"]),
      findings: numify(findings, ["value", "value_max", "confidence"]),
      psi,
      psi_metrics: psiMetrics,
      // Legacy flat fields, kept so an older client keeps rendering.
      psi_summary: psi.summary,
      psi_rows: psi.investigations.flatMap((inv: any) => inv.tables.flatMap((t: any) => t.rows)),
    });
  }

  if (request.method === "GET" && pathname === "/psi") {
    const sql = db(env);
    const investigations: any[] = await sql`
      SELECT i.id, i.version, i.doi, i.license, i.title, i.acronym, i.research_area,
             i.sub_area, i.url, i.project_type, i.flight_platform, i.managing_center,
             i.start_date, i.end_date,
             (SELECT count(*)::int FROM ignis.psi_experiment_table t WHERE t.investigation_id = i.id) AS tables,
             COALESCE((SELECT sum(row_count)::int FROM ignis.psi_experiment_table t WHERE t.investigation_id = i.id), 0) AS rows,
             (SELECT count(DISTINCT l.experiment_id)::int FROM ignis.psi_experiment_link l WHERE l.investigation_id = i.id) AS experiments
        FROM ignis.psi_investigation i ORDER BY i.id`;
    const summary = await sql`
      SELECT count(*)::int AS investigations,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM ignis.psi_experiment_table t WHERE t.investigation_id = i.id))::int AS with_data,
             (SELECT count(*)::int FROM ignis.psi_experiment_table) AS tables,
             (SELECT count(*)::int FROM ignis.psi_test_row) AS rows
        FROM ignis.psi_investigation i`;
    const links: any[] = await sql`
      SELECT e.code, e.name, l.investigation_id
        FROM ignis.psi_experiment_link l JOIN ignis.experiment e ON e.id = l.experiment_id
       ORDER BY e.code, l.investigation_id`;
    return json({
      summary: numifyOne(summary[0], ["investigations", "with_data", "tables", "rows"]),
      investigations: numify(investigations, ["tables", "rows", "experiments"]),
      links,
    });
  }

  const psiMatch = pathname.match(/^\/psi\/([^/]+)$/);
  if (request.method === "GET" && psiMatch) {
    const sql = db(env);
    const id = decodeURIComponent(psiMatch[1]);
    const inv: any[] = await sql`
      SELECT id, version, doi, license, title, acronym, research_area, sub_area, url,
             project_type, flight_platform, managing_center, start_date, end_date
        FROM ignis.psi_investigation WHERE id = ${id}`;
    if (!inv.length) throw notFound(`PSI investigation ${id} not found`);
    const tableRows: any[] = await sql`
      SELECT id, title, file_name, row_count, columns, doi, license, source_url
        FROM ignis.psi_experiment_table WHERE investigation_id = ${id} ORDER BY file_name`;
    const tables = [];
    for (const t of tableRows) {
      const rows: any[] = await sql`
        SELECT row_index, test_id, test_date, data FROM ignis.psi_test_row
         WHERE table_id = ${t.id} ORDER BY row_index LIMIT ${PSI_ROW_LIMIT}`;
      tables.push({
        ...t,
        row_count: Number(t.row_count),
        rows: rows.map((r) => ({
          ...r.data ?? {},
          __index: Number(r.row_index),
          __test_id: r.test_id,
          __test_date: r.test_date,
        })),
      });
    }
    return json({ investigation: inv[0], tables });
  }

  if (request.method === "GET" && pathname === "/documents") {
    const sql = db(env);
    const search = (url.searchParams.get("q") || "").trim();
    const kind = url.searchParams.get("kind") || null;
    const experiment = url.searchParams.get("experiment") || null;
    const limit = Math.min(Number(url.searchParams.get("limit") || 25), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
    const rows = await sql`
      WITH filtered AS (
        SELECT d.*, (SELECT count(*)::int FROM ignis.chunk c WHERE c.document_id = d.id) AS chunks
          FROM ignis.document d
         WHERE (${search} = '' OR d.search_tsv @@ websearch_to_tsquery('english', ${search}) OR d.title ILIKE '%' || ${search} || '%')
           AND (${kind}::text IS NULL OR d.kind::text = ${kind})
           AND (${experiment}::text IS NULL OR EXISTS (
                 SELECT 1 FROM ignis.experiment_document ed JOIN ignis.experiment e ON e.id = ed.experiment_id
                  WHERE ed.document_id = d.id AND (lower(e.code) = lower(${experiment}) OR ${experiment} = ANY(e.aliases))))
      )
      SELECT id, source_id, title, kind, abstract, authors, published_date, word_count, quality_score, has_fulltext, landing_url, chunks
        FROM filtered ORDER BY quality_score DESC NULLS LAST, id LIMIT ${limit} OFFSET ${offset}`;
    const total = await sql`
      SELECT count(*)::int AS n FROM ignis.document d
       WHERE (${search} = '' OR d.search_tsv @@ websearch_to_tsquery('english', ${search}) OR d.title ILIKE '%' || ${search} || '%')
         AND (${kind}::text IS NULL OR d.kind::text = ${kind})
         AND (${experiment}::text IS NULL OR EXISTS (
               SELECT 1 FROM ignis.experiment_document ed JOIN ignis.experiment e ON e.id = ed.experiment_id
                WHERE ed.document_id = d.id AND (lower(e.code) = lower(${experiment}) OR ${experiment} = ANY(e.aliases))))`;
    return json({
      documents: numify(rows, ["word_count", "quality_score", "chunks"]),
      total: Number(total[0]?.n ?? 0), limit, offset,
    });
  }

  const docMatch = pathname.match(/^\/documents\/([^/]+)$/);
  if (request.method === "GET" && docMatch) {
    const documentId = Number(decodeURIComponent(docMatch[1]));
    if (!Number.isFinite(documentId)) throw badRequest("invalid document id");
    const sql = db(env);
    const docs: any[] = await sql`SELECT id, source, source_id, kind, title, abstract, authors, report_numbers, center, distribution, keywords, subject_categories, published_date, word_count, char_count, quality_score, landing_url FROM ignis.document WHERE id = ${documentId}`;
    if (!docs.length) throw notFound("document not found");
    const chunks: any[] = await sql`SELECT c.id, c.ordinal, c.kind, c.section_path, c.token_count, left(c.content, 600) AS preview, EXISTS (SELECT 1 FROM ignis.chunk_embedding e WHERE e.chunk_id = c.id) AS embedded FROM ignis.chunk c WHERE c.document_id = ${documentId} ORDER BY c.ordinal`;
    const findings: any[] = await sql.query(
      `SELECT id, metric, value, value_max, unit, statement,
              ${CONF_SQL_FINDING} AS confidence, extraction_method, evidence_quote, role,
              review_status, source_layer
         FROM ignis.finding WHERE document_id = $1 ORDER BY metric LIMIT 100`,
      [documentId]) as any[];
    const experiments: any[] = await sql`SELECT e.code, e.name, ed.relation FROM ignis.experiment_document ed JOIN ignis.experiment e ON e.id = ed.experiment_id WHERE ed.document_id = ${documentId}`;
    return json({
      document: numifyOne(docs[0], ["word_count", "char_count", "quality_score"]),
      chunks: numify(chunks, ["ordinal", "token_count"]),
      findings: numify(findings, ["value", "value_max", "confidence"]),
      experiments,
    });
  }

  if (request.method === "GET" && pathname === "/datasets") {
    const sql = db(env);
    const rows = await sql.query(`${DERIVED_DATASET_SQL}
       ORDER BY value_count DESC, name`) as any[];
    const total = rows.reduce((n: number, r: any) => n + Number(r.value_count ?? 0), 0);
    return json({
      datasets: numify(rows, [
        "value_count", "outcome_count", "condition_count", "derived_count",
        "document_count", "recorded_unit_count", "value_min", "value_max",
        "ranged_value_count", "mean_confidence",
      ]),
      total_measurements: total,
      note: "Counts and ranges come from one normalized data service. Conditions (test inputs) are reported separately from outcomes (measured results); none are hand-verified.",
    });
  }

  const dsMatch = pathname.match(/^\/datasets\/([^/]+)$/);
  if (request.method === "GET" && dsMatch) {
    const sql = db(env);
    const key = decodeURIComponent(dsMatch[1]);
    const meta: any[] = await sql.query(`${DERIVED_DATASET_SQL} WHERE d.key = $1 LIMIT 1`, [key]) as any[];
    if (!meta.length) throw notFound(`dataset ${key} not found`);
    const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
    const rows: any[] = await sql.query(
      `SELECT finding_id, value, unit, raw_value, raw_unit, value_max, statement,
              evidence_quote, ${CONF_SQL} AS confidence, extraction_method, role, review_status,
              source_layer, document_id, document_source_id, document_title,
              landing_url, experiment_code, experiment_name
         FROM ignis.dataset_row
        WHERE dataset_key = $1
        ORDER BY value
        LIMIT ${limit}`, [key]) as any[];
    // Statistics come from SQL, not the client, so the UI cannot accidentally
    // present a number that was computed over a truncated page of rows. They are
    // split by role because a summary over conditions and outcomes mixed
    // together is not a meaningful quantity.
    const stats: any[] = await sql`
      SELECT coalesce(role, 'unknown') AS role,
             count(*)::int AS n,
             round(min(value)::numeric,4) AS min_value,
             round(max(value)::numeric,4) AS max_value,
             round(avg(value)::numeric,4) AS mean_value,
             round(stddev_samp(value)::numeric,4) AS sd_value,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::numeric,4) AS median_value,
             count(*) FILTER (WHERE value_max IS NOT NULL)::int AS ranged
        FROM ignis.dataset_row WHERE dataset_key = ${key}
        GROUP BY 1 ORDER BY 1`;
    // width_bucket throws "lower bound cannot equal upper bound" when every
    // value is identical, which is common for a metric with a handful of rows;
    // fall back to a single bucket so the endpoint still returns its stats.
    const histogram: any[] = await sql`
      WITH bounds AS (
        SELECT min(value) AS lo, max(value) AS hi
          FROM ignis.dataset_row WHERE dataset_key = ${key}
      ),
      b AS (
        SELECT CASE WHEN (SELECT hi FROM bounds) > (SELECT lo FROM bounds)
                    THEN width_bucket(value, (SELECT lo FROM bounds), (SELECT hi FROM bounds), 10)
                    ELSE 1 END AS bucket, value
          FROM ignis.dataset_row WHERE dataset_key = ${key}
      )
      SELECT bucket, count(*)::int AS n, round(min(value)::numeric,4) AS lo, round(max(value)::numeric,4) AS hi
        FROM b GROUP BY bucket ORDER BY bucket`;
    return json({
      dataset: numifyOne(meta[0], [
        "value_count", "outcome_count", "condition_count", "derived_count",
        "document_count", "recorded_unit_count", "value_min", "value_max",
        "ranged_value_count", "mean_confidence",
      ]),
      rows: numify(rows, ["value", "raw_value", "value_max", "confidence"]),
      stats: numify(stats, ["n", "min_value", "max_value", "mean_value", "sd_value", "median_value", "ranged"]),
      histogram: numify(histogram, ["bucket", "n", "lo", "hi"]),
    });
  }

  if (request.method === "GET" && pathname === "/global-search") {
    const sql = db(env);
    const query = (url.searchParams.get("q") || "").trim();
    if (!query) return json({ query, experiments: [], datasets: [], documents: [], findings: [] });
    const like = `%${query}%`;
    const [experiments, datasets, documents, findings] = await Promise.all([
      sql`SELECT code, name, campaign, objective FROM ignis.experiment
           WHERE code ILIKE ${like} OR name ILIKE ${like} OR objective ILIKE ${like} OR ${query} = ANY(aliases)
           ORDER BY code LIMIT 8`,
      sql`SELECT key, name, canonical_unit, value_count FROM ignis.dataset
           WHERE name ILIKE ${like} OR key ILIKE ${like} ORDER BY value_count DESC LIMIT 8`,
      sql`SELECT id, source_id, title, kind, landing_url FROM ignis.document
           WHERE title ILIKE ${like} OR abstract ILIKE ${like} OR search_tsv @@ websearch_to_tsquery('english', ${query})
           ORDER BY quality_score DESC NULLS LAST LIMIT 10`,
      sql`SELECT f.id, f.metric, f.value, f.unit, f.statement, f.document_id, f.evidence_quote
             FROM ignis.finding f
            WHERE f.statement ILIKE ${like} OR f.metric ILIKE ${like}
            ORDER BY f.metric LIMIT 10`,
    ]);
    return json({ query, experiments, datasets, documents, findings });
  }

  if (request.method === "GET" && pathname === "/search") {
    const query = (url.searchParams.get("q") || "").trim();
    const k = Math.min(Number(url.searchParams.get("k") || 12), 50);
    if (!query) return json({ query: "", hits: [] });
    const hits = await retrieve(env, query, k);
    return json({ query, hits: hits.map((h) => ({ ...h })) });
  }

  // Smart Ranking explainer: the full pipeline with every score exposed so a
  // reviewer can see why a passage ranked where it did.
  if (request.method === "GET" && pathname === "/rank") {
    const query = (url.searchParams.get("q") || "").trim();
    const k = Math.min(Number(url.searchParams.get("k") || 10), 30);
    if (!query) throw badRequest("q is required");
    const t0 = Date.now();
    // The corpus is English; a non-Latin query is translated once here so the
    // ranking is explainable in the language the reviewer typed.
    const rq = await retrievalQuery(env, query);
    const qvec = await embedSafe(env, rq);
    // Fetch a wide candidate pool so ranking has something to reorder; the
    // user-facing k only bounds the final diversified selection. Without
    // embeddings (quota exhausted) fall back to the lexical pool.
    const raw = qvec
      ? await hybridSearch(env, rq, qvec, 60, 80)
      : await keywordSearch(env, rq, 60, 80);
    rerank(rq, raw);
    smartRank(raw, rq);
    const relevant = relevanceGate(raw, rq);
    const diversified = mmrDiversify([...relevant], k);
    // PSI measured rows are merged here too, so this page shows the same
    // evidence the search and the agent use instead of paper prose alone.
    const merged = await mergePsi(env, rq, diversified, k);
    // The SI rerank is the last step, exactly as in `retrieve()`, so this page
    // shows the order the assistant actually uses.
    const ranked = await siRerank(env, query, merged);
    const grade = heuristicGrade(ranked);
    const kept = new Set(ranked.map((h) => h.chunk_id));
    return json({
      query,
      retrieval_query: rq,
      k,
      weights: RANK_WEIGHTS,
      si_weight: SI_WEIGHT,
      pool: raw.length,
      latency_ms: Date.now() - t0,
      verdict: grade.verdict,
      grade_score: Number(grade.score.toFixed(4)),
      // Show the passages that cleared the relevance gate; `dropped` counts the
      // rest so a reviewer can see how many candidates were rejected as off-topic.
      dropped: raw.length - relevant.length,
      hits: ranked.map((h, i) => ({
        ...h,
        pre_rank: i + 1,
        diversified: kept.has(h.chunk_id),
      })),
    });
  }

  return null;
}
