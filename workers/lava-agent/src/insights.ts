/**
 * SI-written fire-safety insights.
 *
 * The dashboard's insight cards are the "interpret" half of the challenge:
 * the SI core reads the retrieved evidence for a topic and writes the finding
 * itself, rather than a fixed template that only echoes the passages. Each
 * insight stays grounded - the model sees numbered evidence blocks and is told
 * to use nothing else - and carries the documents it drew from.
 *
 * The refresh runs out of band through `POST /admin/insights/refresh` (shared
 * secret), because it makes one model call per topic and would not fit inside a
 * page request. Until it runs, the page serves whatever the pipeline last
 * wrote, so a model outage degrades to the previous insights instead of an
 * empty panel.
 */
import type { Env } from "./db";
import { db } from "./db";
import { llmChat, parseJsonObject, DEFAULT_FAST_MODEL, type ChatMessage } from "./llm";
import { log } from "./http";
import { retrieve, type Hit } from "./retrieval";

/** One insight per topic, matching the taxonomy the pipeline seeds so a
 *  refresh overwrites the deterministic card instead of adding a duplicate. */
export const INSIGHT_TOPICS: { topic: string; category: string; severity: string }[] = [
  { topic: "flame spread over solid fuels in microgravity", category: "material_flammability", severity: "high" },
  { topic: "flame extinction limits and quenching in microgravity", category: "suppression", severity: "high" },
  { topic: "limiting oxygen concentration for spacecraft fire safety", category: "atm_composition", severity: "critical" },
  { topic: "smoke and soot production for spacecraft fire detection", category: "detection", severity: "medium" },
  { topic: "fire suppression agents and methods in microgravity", category: "suppression", severity: "high" },
  { topic: "low-temperature cool flame ignition hazards", category: "ops_risk", severity: "medium" },
  { topic: "pressure and atmosphere effects on spacecraft flammability", category: "atm_composition", severity: "high" },
  { topic: "large-scale fire growth in spacecraft (SAFFIRE) lessons", category: "ops_risk", severity: "critical" },
];

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

const INSIGHT_SYSTEM =
  "You are the analysis core of a microgravity-combustion research assistant. " +
  "You receive a fire-safety topic and numbered evidence passages from NASA " +
  "reports and measured experiment tables. Write ONE insight for spacecraft " +
  "fire-safety engineers: what the corpus shows on this topic and what it means " +
  "for design. Use only the evidence - never add a fact, number or name that is " +
  "not in the blocks. Cite the blocks you rely on with bracketed numbers like " +
  "[1]. Be concrete: name the quantities, materials or campaigns the evidence " +
  "gives. Close with the data limitation. Write 3 to 5 sentences of plain prose. " +
  'Return JSON: {"title": str, "body": str, "severity": "info"|"low"|"medium"|' +
  '"high"|"critical", "confidence": 0..1}.';

/** Turn a title into a stable slug, so a refresh updates the same row. */
function slugify(title: string, idx: number): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "insight"}-${idx}`;
}

function clampText(s: unknown, n: number): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
}

/** Model prose can carry a typographic dash; keep the body plain text. */
function plainDash(s: string): string {
  return s.replace(/[\u2010-\u2015]/g, "-").replace(/\u2026/g, "...");
}

function evidenceBlocks(hits: Hit[], n = 6): string {
  return hits.slice(0, n).map((h, i) => {
    const isPsi = (h as any).source_type === "psi";
    const source = isPsi ? `measured table, ${h.source_id}` : h.title || h.source_id;
    return `[${i + 1}] ${source}\n${clampText(h.content, 900)}`;
  }).join("\n\n");
}

export type InsightDraft = {
  title: string;
  body: string;
  category: string;
  severity: string;
  confidence: number;
  supporting_documents: number[];
};

/** Write one insight for a topic from the retrieved evidence, or null when the
 *  model returns nothing usable (the caller then keeps the previous row). */
export async function draftInsight(env: Env, topic: string, category: string,
                                   severity: string, model?: string): Promise<InsightDraft | null> {
  const hits = await retrieve(env, topic, 6);
  if (!hits.length) return null;
  const used = hits.slice(0, 5);
  const docIds = [...new Set(used.map((h) => Number(h.document_id)).filter((n) => n > 0))];
  const messages: ChatMessage[] = [
    { role: "system", content: INSIGHT_SYSTEM },
    { role: "user", content: `Topic: ${topic}\nCategory: ${category}\n\nEvidence:\n${evidenceBlocks(used)}` },
  ];
  let data: any;
  try {
    const raw = await llmChat(env, messages, model || env.LAVA_FAST_MODEL || DEFAULT_FAST_MODEL, {
      jsonMode: true, maxTokens: 900, effort: "low", timeoutMs: 60000,
    });
    data = parseJsonObject(raw);
  } catch (err: any) {
    log("insight_draft_failed", { topic, message: String(err?.message ?? err).slice(0, 200) });
    return null;
  }
  const title = plainDash(clampText(data?.title || topic, 200));
  const body = plainDash(clampText(data?.body, 1600));
  if (!body) return null;
  const sev = String(data?.severity ?? severity).toLowerCase();
  let conf = Number(data?.confidence);
  if (!Number.isFinite(conf)) conf = 0.6;
  conf = Math.min(1, Math.max(0, conf));
  return {
    title,
    body,
    category,
    severity: SEVERITIES.has(sev) ? sev : severity,
    confidence: Math.round(conf * 1000) / 1000,
    supporting_documents: docIds,
  };
}

/** Generate and persist every insight. Returns a per-topic report.
 *
 *  All topics are drafted before anything is written, and the legacy rows are
 *  replaced only when most drafts succeed: a partial model outage must not wipe
 *  a good set of insights for a thinner one. */
export async function refreshInsights(env: Env, model?: string): Promise<{ written: number; skipped: number; items: any[] }> {
  const sql = db(env);
  const items: any[] = [];
  const drafts: { slug: string; d: InsightDraft }[] = [];

  for (let i = 0; i < INSIGHT_TOPICS.length; i++) {
    const { topic, category, severity } = INSIGHT_TOPICS[i];
    const d = await draftInsight(env, topic, category, severity, model);
    if (!d) {
      items.push({ topic, ok: false });
      continue;
    }
    // A stable slug per topic, so a refresh replaces the same card instead of
    // stacking a second one next to the deterministic version.
    drafts.push({ slug: `${slugify(topic, 0)}-${i + 1}`, d });
    items.push({ topic, ok: true, slug: drafts[drafts.length - 1].slug, severity: d.severity, confidence: d.confidence });
  }

  const skipped = INSIGHT_TOPICS.length - drafts.length;
  if (drafts.length < Math.ceil(INSIGHT_TOPICS.length / 2)) {
    log("insight_refresh_aborted", { drafted: drafts.length, skipped });
    return { written: 0, skipped, items };
  }

  // Drop the deterministic/analyst rows this refresh supersedes, then write the
  // SI set. One transaction, so a reader never sees an empty panel between the
  // delete and the inserts.
  const statements: any[] = [
    sql`DELETE FROM ignis.insight WHERE generated_by IS DISTINCT FROM 'lava-si'`,
  ];
  for (const { slug, d } of drafts) {
    statements.push(sql`
      INSERT INTO ignis.insight
        (slug, title, body, category, severity, confidence,
         supporting_findings, supporting_documents, generated_by)
      VALUES (${slug}, ${d.title}, ${d.body}, ${d.category},
              ${d.severity}, ${d.confidence}, '{}'::bigint[],
              ${d.supporting_documents}::bigint[], 'lava-si')
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title, body = EXCLUDED.body,
        category = EXCLUDED.category, severity = EXCLUDED.severity,
        confidence = EXCLUDED.confidence,
        supporting_documents = EXCLUDED.supporting_documents,
        generated_by = EXCLUDED.generated_by`);
  }
  await sql.transaction(statements as any);
  return { written: drafts.length, skipped, items };
}
