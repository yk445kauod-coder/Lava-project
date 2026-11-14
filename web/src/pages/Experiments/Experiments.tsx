import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { Chart } from "../../components/Chart";
import { PsiSection, type PsiRecord } from "../../components/PsiTables";
import { Icon } from "../../components/Icon";
import { Empty, PageHead, Panel, Skeleton, Stat } from "../../components/Page";
import { barList } from "../../lib/chart";
import { fmt, num, pct } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import { useTranslated } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

interface ExperimentSummary {
  id: unknown;
  code: string;
  name: string | null;
  campaign: string | null;
  status: string | null;
  gravity_level: unknown;
  fuel_type: string | null;
  ambient_gas: string | null;
  o2_fraction: unknown;
  pressure_kpa: unknown;
  objective: string | null;
  summary: string | null;
  aliases: string[];
  facility: string | null;
  facility_name: string | null;
  platform: string | null;
  documents: unknown;
  findings: unknown;
  psi_investigation_id?: string | null;
  psi_status?: string | null;
}

interface Facility {
  id: unknown;
  code: string;
  name: string;
  platform: string | null;
  agency: string | null;
  g_level: unknown;
  description: string | null;
  experiments: unknown;
}

interface ListResponse {
  experiments?: ExperimentSummary[];
  facilities?: Facility[];
}

interface ExperimentDetail extends ExperimentSummary {
  g_level: unknown;
}

interface Document {
  id: unknown;
  source_id: string | null;
  title: string;
  kind: string | null;
  published_date: string | null;
  word_count: unknown;
  quality_score: unknown;
  landing_url: string | null;
  relation: string | null;
}

interface Finding {
  id: unknown;
  metric: string | null;
  value: unknown;
  value_max: unknown;
  unit: string | null;
  statement: string | null;
  confidence: unknown;
  evidence_quote: string | null;
  document_id: unknown;
}

interface DetailResponse {
  experiment?: ExperimentDetail;
  documents?: Document[];
  findings?: Finding[];
  psi?: PsiRecord | null;
}

/** Reduced-gravity level, e.g. "1.0e-4 g"; em dash when not reported. */
const grav = (g: unknown): string => {
  const v = num(g);
  return v === null ? "-" : `${v.toExponential(1)} g`;
};

function ListView() {
  const { t } = useI18n();
  const { data, loading, error } = useApi<ListResponse>("/api/experiments");
  const [query, setQuery] = useState("");

  const exps = data?.experiments ?? [];
  const facs = data?.facilities ?? [];
  const totalDocs = exps.reduce((a, x) => a + (num(x.documents) ?? 0), 0);
  const totalFindings = exps.reduce((a, x) => a + (num(x.findings) ?? 0), 0);

  const expNames = useTranslated(exps.map((x) => x.name || x.code));
  const facPlatforms = useTranslated(facs.map((f) => (f.platform || "").replace(/_/g, " ")));
  const facNames = useTranslated(facs.map((f) => f.name));

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      exps
        .map((x, i) => ({ x, i }))
        .filter(({ x, i }) => {
          if (!q) return true;
          return [x.code, expNames[i], x.campaign, x.facility_name]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(q));
        })
        .sort((a, b) => (num(b.x.documents) ?? 0) - (num(a.x.documents) ?? 0)),
    [exps, expNames, q],
  );

  // A condition reads as a plain value or as "not reported"; never "n/r".
  const cond = (v: unknown, unit: string) =>
    num(v) === null ? t("not reported") : `${fmt(v)}${unit ? ` ${unit}` : ""}`;

  if (loading) {
    return (
      <Panel>
        <Skeleton rows={5} />
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <Empty icon="alert">{error}</Empty>
      </Panel>
    );
  }

  return (
    <>
      <PageHead
        title={t("Experiments")}
        sub={t("{n} microgravity combustion experiments across {m} facilities")
          .replace("{n}", fmt(exps.length))
          .replace("{m}", fmt(facs.length))}
      >
        <div className="field" style={{ minWidth: 240 }}>
          <Icon name="search" size={14} />
          <input
            aria-label={t("Search experiments")} placeholder={t("Search experiments")}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </PageHead>

      <div className="stat-row">
        <Stat label={t("Experiments")} value={exps.length} sub={t("campaigns catalogued")} />
        <Stat label={t("Linked documents")} value={totalDocs} sub={t("NTRS reports")} />
        <Stat label={t("Extracted findings")} value={totalFindings} sub={t("candidate values")} />
        <Stat label={t("Facilities")} value={facs.length} sub={t("platforms & labs")} />
      </div>

      <div className="table-card exp">
        <div className="table-head">
          <span>{t("Experiment")}</span>
          <span>{t("Campaign")}</span>
          <span className="num">O₂</span>
          <span className="num">{t("Pressure")}</span>
          <span className="num">{t("Documents")}</span>
          <span className="num">{t("Findings")}</span>
          <span className="num" />
        </div>
        {shown.map(({ x, i }) => (
          <Link
            className="table-row"
            key={x.code}
            to={`/experiments?code=${encodeURIComponent(x.code)}`}
          >
            <span className="table-name">
              {expNames[i] || x.code}
              <span className="table-sub">{x.code}{x.status ? ` · ${t(x.status)}` : ""}</span>
            </span>
            <span className="tag" data-label={t("Campaign")}>{x.campaign || "-"}</span>
            <span className="num" data-label="O₂">{num(x.o2_fraction) !== null ? pct(x.o2_fraction) : t("not reported")}</span>
            <span className="num" data-label={t("Pressure")}>{cond(x.pressure_kpa, "kPa")}</span>
            <span className="num" data-label={t("Documents")}>{fmt(x.documents)}</span>
            <span className="num" data-label={t("Findings")}>{fmt(x.findings)}</span>
            <span className="num table-go" aria-hidden="true">›</span>
          </Link>
        ))}
        {!shown.length ? <div className="table-empty">{t("No experiments match this search")}</div> : null}
      </div>

      <div className="sec-head">
        <h2>{t("Facilities & platforms")}</h2>
        <span className="muted small">{fmt(facs.length)}</span>
      </div>

      <div className="table-card fac">
        <div className="table-head">
          <span>{t("Facility")}</span>
          <span>{t("Platform")}</span>
          <span>{t("Agency")}</span>
          <span className="num">{t("Experiments")}</span>
        </div>
        {facs.length ? (
          facs.map((f, i) => (
            <div className="table-row" key={f.code}>
              <span className="table-name">
                {facNames[i] || f.code}
                <span className="table-sub">{f.code}</span>
              </span>
              <span className="tag" data-label={t("Platform")}>{facPlatforms[i] || "-"}</span>
              <span className="tag" data-label={t("Agency")}>{f.agency || "-"}</span>
              <span className="num" data-label={t("Experiments")}>{fmt(f.experiments)}</span>
            </div>
          ))
        ) : (
          <div className="table-empty">{t("No facilities")}</div>
        )}
      </div>
    </>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  const { t } = useI18n();
  const labels = useTranslated(findings.map((f) => f.metric));
  const statements = useTranslated(findings.map((f) => f.statement));
  const quotes = useTranslated(findings.map((f) => f.evidence_quote));

  if (!findings.length) return <Empty icon="flask">{t("No extracted findings")}</Empty>;

  return (
    <>
      {findings.map((f, i) => {
        const v = num(f.value);
        const vm = num(f.value_max);
        const range = `${v !== null ? fmt(v) : ""}${vm !== null && vm !== v ? `-${fmt(vm)}` : ""}`;
        const conf = num(f.confidence);
        return (
          <div className="find" key={String(f.id)}>
            <div className="hstack wrap">
              <b>{labels[i] || "-"}</b>
              <span>
                {range}
                {f.unit ? ` ${f.unit}` : ""}
              </span>
              <span className="spacer" />
              <span className="muted small" title={t("machine-extracted, not hand-verified")}>
                {t("not verified")}
              </span>
              <span className="muted small">{t("confidence {n}").replace("{n}", conf === null ? "-" : conf.toFixed(2))}</span>
            </div>
            {statements[i] && (
              <div className="small" style={{ marginTop: 6 }}>
                {statements[i]}
              </div>
            )}
            {quotes[i] && (
              <blockquote className="small muted quote">
                "{quotes[i]}"
              </blockquote>
            )}
            {f.document_id != null && (
              <div className="meta" style={{ marginTop: 8 }}>
                <Link className="cite" to={`/explorer?id=${encodeURIComponent(String(f.document_id))}`}>
                  {t("Source document")} →
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function DetailView({ code }: { code: string }) {
  const { t } = useI18n();
  const { data, loading, error } = useApi<DetailResponse>(`/api/experiments/${encodeURIComponent(code)}`);

  const x = data?.experiment;
  const findings = data?.findings ?? [];
  const docs = data?.documents ?? [];
  const psi = data?.psi ?? null;
  const aliases = x?.aliases ?? [];

  const [xName, xObjective, xSummary] = useTranslated([x?.name, x?.objective, x?.summary]);
  const docTitles = useTranslated(docs.map((d) => d.title));

  const metrics = useMemo(() => {
    const by = new Map<string, Finding[]>();
    findings.forEach((f) => {
      const k = f.metric || "other";
      const rows = by.get(k) ?? [];
      rows.push(f);
      by.set(k, rows);
    });
    return [...by.entries()]
      .map(([metric, rows]) => ({
        metric,
        n: rows.length,
        max: Math.max(0, ...rows.map((r) => num(r.value_max ?? r.value) ?? 0)),
      }))
      .sort((a, b) => b.n - a.n);
  }, [findings]);

  if (loading) {
    return (
      <Panel>
        <Skeleton rows={6} />
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <Empty icon="alert">{error}</Empty>
      </Panel>
    );
  }

  if (!x) {
    return (
      <Panel>
        <Empty icon="flask">{t("Experiment not found")}</Empty>
      </Panel>
    );
  }

  const metricHtml = metrics.length
    ? barList(
        metrics.map((m) => ({ label: m.metric, value: m.n, sub: t("max {n}").replace("{n}", fmt(m.max)) })),
        { unit: t("rows") },
      )
    : null;

  return (
    <>
      <PageHead
        title={xName || x.code}
        sub={`${x.code} · ${x.campaign || "-"} · ${x.fuel_type || t("fuel not reported")}`}
      >
        <span className="muted small">{x.status ? t(x.status) : "-"}</span>
      </PageHead>

      <div className="stat-row">
        <Stat label={t("Documents")} value={docs.length} sub={t("NTRS reports")} />
        <Stat label={t("Findings")} value={findings.length} sub={`${fmt(metrics.length)} ${t("metrics")}`} />
        <Stat label={t("Gravity")} value={grav(x.gravity_level)} sub={t("reduced gravity level")} count={false} />
        <Stat
          label={t("Pressure")}
          value={num(x.pressure_kpa) !== null ? `${fmt(x.pressure_kpa)} kPa` : t("n/r")}
          sub={num(x.o2_fraction) !== null ? `O₂ ${pct(x.o2_fraction)}` : t("O₂ not reported")}
          count={false}
        />
      </div>

      <div className="two-a">
        <Panel title={t("Findings by metric")} sub={`${fmt(findings.length)} ${t("candidate measurements")}`}>
          <Findings findings={findings} />
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Panel title={t("Metric coverage")} sub={t("measurements per quantity")}>
            <Chart html={metricHtml} />
          </Panel>

          <Panel title={t("Conditions")}>
            <dl className="dl">
              <dt>{t("Campaign")}</dt>
              <dd>{x.campaign || "-"}</dd>
              <dt>{t("Gravity")}</dt>
              <dd>{grav(x.gravity_level)}</dd>
              <dt>{t("Fuel")}</dt>
              <dd>{x.fuel_type || t("not reported")}</dd>
              <dt>{t("Ambient gas")}</dt>
              <dd>{x.ambient_gas || t("not reported")}</dd>
              <dt>O₂</dt>
              <dd>{num(x.o2_fraction) !== null ? pct(x.o2_fraction) : t("not reported")}</dd>
              <dt>{t("Pressure")}</dt>
              <dd>{num(x.pressure_kpa) !== null ? `${fmt(x.pressure_kpa)} kPa` : t("not reported")}</dd>
              {aliases.length > 0 && (
                <>
                  <dt>{t("Aliases")}</dt>
                  <dd className="mono2">{aliases.join(", ")}</dd>
                </>
              )}
            </dl>
          </Panel>

          <Panel
            title={t("PSI data record")}
            sub={
              psi?.summary
                ? `${fmt(psi.summary.tables)} ${t("tables")} · ${fmt(psi.summary.rows)} ${t("rows")}`
                : t("not yet ingested")
            }
          >
            {psi && psi.investigations.length ? (
              <div style={{ padding: "14px 18px 16px" }}>
                <PsiSection psi={psi} />
              </div>
            ) : (
              <div style={{ padding: "14px 18px 16px" }}>
                <p className="small muted" style={{ margin: 0 }}>
                  {t(
                    "This investigation is catalogued from NTRS literature. It is not yet linked to a PSI experimental-data record, which is not the same as being absent from PSI.",
                  )}
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {(x.objective || x.summary) && (
        <Panel title={t("Objective & summary")}>
          <div style={{ padding: "16px 18px 18px" }}>
            {x.objective && (
              <>
                <div className="lbl">{t("Objective")}</div>
                <p style={{ margin: "6px 0 14px" }}>{xObjective}</p>
              </>
            )}
            {x.summary && (
              <>
                <div className="lbl">{t("Summary")}</div>
                <p style={{ margin: "6px 0 0" }}>{xSummary}</p>
              </>
            )}
          </div>
        </Panel>
      )}

      <Panel
        title={t("Related documents")}
        sub={`${fmt(docs.length)} ${t("NTRS reports")}`}
      >
        {docs.length ? (
          docs.map((doc, i) => (
            <Link
              className="find"
              key={String(doc.id)}
              to={`/explorer?id=${encodeURIComponent(String(doc.id))}`}
            >
              <b>{docTitles[i]}</b>
              <div className="meta">
                <span className="cite">NTRS {doc.source_id}</span>
                {doc.relation && <span>{doc.relation}</span>}
                <span className="spacer" />
                <span>
                  {fmt(doc.word_count)} {t("words")}
                </span>
              </div>
            </Link>
          ))
        ) : (
          <Empty>{t("No linked documents")}</Empty>
        )}
      </Panel>
    </>
  );
}

export default function Experiments() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const code = params.get("code");

  return (
    <AppShell subtitle={t("Experiments")}>
      {code ? <DetailView code={code} /> : <ListView />}
    </AppShell>
  );
}
