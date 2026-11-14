import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { Chart } from "../../components/Chart";
import { Icon } from "../../components/Icon";
import { Empty, PageHead, Panel, Skeleton, Stat } from "../../components/Page";
import { bars } from "../../lib/chart";
import { fmt, num } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import { useTranslated, useTranslatedClamped } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

/** One row of the dataset index; numeric fields may arrive as strings. */
interface DatasetSummary {
  key: string;
  name: string;
  canonical_unit: string | null;
  value_count: unknown;
  outcome_count?: unknown;
  condition_count?: unknown;
  derived_count?: unknown;
  document_count: unknown;
  recorded_unit_count: unknown;
  recorded_units: string[] | null;
  value_min: unknown;
  value_max: unknown;
  ranged_value_count: unknown;
  mean_confidence: unknown;
  extraction_methods: string[] | null;
}

interface DatasetsResponse {
  datasets?: DatasetSummary[];
  total_measurements?: unknown;
  note?: string;
}

interface DatasetRow {
  finding_id?: unknown;
  value?: unknown;
  unit?: string | null;
  raw_value?: unknown;
  raw_unit?: string | null;
  value_max?: unknown;
  statement?: string | null;
  evidence_quote?: string | null;
  confidence?: unknown;
  extraction_method?: string | null;
  role?: string | null;
  review_status?: string | null;
  source_layer?: string | null;
  document_id?: unknown;
  document_source_id?: unknown;
  document_title?: string | null;
  landing_url?: string | null;
  experiment_code?: string | null;
  experiment_name?: string | null;
}

interface DatasetDetail {
  key?: string;
  name?: string;
  canonical_unit?: string | null;
  value_count?: unknown;
  document_count?: unknown;
  value_min?: unknown;
  value_max?: unknown;
  mean_confidence?: unknown;
}

interface DatasetStats {
  role?: string | null;
  n?: unknown;
  min_value?: unknown;
  max_value?: unknown;
  mean_value?: unknown;
  sd_value?: unknown;
  median_value?: unknown;
  ranged?: unknown;
}

interface HistogramBucket {
  bucket?: unknown;
  n?: unknown;
  lo?: unknown;
  hi?: unknown;
}

interface DetailResponse {
  dataset?: DatasetDetail;
  rows?: DatasetRow[];
  stats?: DatasetStats[];
  histogram?: HistogramBucket[];
}

/** Mean extraction confidence rendered to two decimals, or an em dash. */
function conf(v: unknown): string {
  const n = num(v);
  return n === null ? "-" : n.toFixed(2);
}

/** Small coloured tag naming a value's role, so a test condition is never read
 *  as a measured outcome. */
function RoleTag({ role }: { role?: string | null }) {
  const { t } = useI18n();
  if (!role) return null;
  const label =
    role === "condition"
      ? t("Condition")
      : role === "outcome"
      ? t("Outcome")
      : role === "derived"
      ? t("Derived")
      : role;
  return <span className={`role-tag role-${role}`}>{label}</span>;
}

function ListView({ data }: { data: DatasetsResponse }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const all = useMemo(
    () =>
      (data.datasets ?? [])
        .slice()
        .sort((a, b) => (num(b.value_count) ?? 0) - (num(a.value_count) ?? 0)),
    [data],
  );
  const names = useTranslated(all.map((x) => x.name));
  const totalDocs = all.reduce((a, x) => a + (num(x.document_count) ?? 0), 0);
  const maxN = Math.max(1, ...all.map((x) => num(x.value_count) ?? 0));

  // Filter by the name a reader sees in their own language, and by the raw key
  // so a search for "pressure_kpa" still lands.
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      all
        .map((x, i) => ({ x, i }))
        .filter(({ x, i }) => !q || names[i]?.toLowerCase().includes(q) || x.key.includes(q)),
    [all, names, q],
  );

  if (!all.length) return <Empty>{t("No datasets")}</Empty>;

  return (
    <>
      <PageHead
        title={t("Measurements & Data")}
        sub={t("{n} metric datasets with {m} candidate values mined from report text")
          .replace("{n}", fmt(all.length))
          .replace("{m}", fmt(data.total_measurements))}
      >
        <div className="field" style={{ minWidth: 240 }}>
          <Icon name="search" size={14} />
          <input
            aria-label={t("Search measurements")} placeholder={t("Search measurements")}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </PageHead>

      <div className="stat-row">
        <Stat label={t("Datasets")} value={all.length} sub={t("distinct quantities")} />
        <Stat label={t("Measurements")} value={num(data.total_measurements) ?? 0} sub={t("candidate values")} />
        <Stat label={t("Documents")} value={totalDocs} sub={t("contributing reports")} />
        <Stat label={t("Largest set")} value={maxN} sub={names[0] ?? "-"} />
      </div>

      <div className="table-card">
        <div className="table-head">
          <span>{t("Measurement")}</span>
          <span className="num">{t("Values")}</span>
          <span className="num">{t("Documents")}</span>
          <span className="num">{t("Range")}</span>
          <span>{t("Unit")}</span>
          <span className="num">{t("Confidence")}</span>
          <span className="num" />
        </div>
        {shown.map(({ x, i }) => {
          const c = num(x.mean_confidence);
          return (
            <Link className="table-row" key={x.key} to={`/datasets?key=${encodeURIComponent(x.key)}`}>
              <span className="table-name">{names[i]}</span>
              <span className="num" data-label={t("Values")}>{fmt(x.value_count)}</span>
              <span className="num" data-label={t("Documents")}>{fmt(x.document_count)}</span>
              <span className="num" data-label={t("Range")}>
                {fmt(x.value_min)}-{fmt(x.value_max)}
              </span>
              <span className="table-unit" data-label={t("Unit")}>{x.canonical_unit ?? "-"}</span>
              <span className="num" data-label={t("Confidence")}>
                {c === null ? (
                  "-"
                ) : (
                  <>
                    {Math.round(c * 100)}%
                    <span className="meter" aria-hidden="true">
                      <i style={{ width: `${Math.round(c * 100)}%` }} />
                    </span>
                  </>
                )}
              </span>
              <span className="num table-go" aria-hidden="true">
                ›
              </span>
            </Link>
          );
        })}
        {!shown.length ? (
          <div className="table-empty">{t("No measurements match this search")}</div>
        ) : null}
      </div>
    </>
  );
}

function DetailView({ data, fallbackKey }: { data: DetailResponse; fallbackKey: string }) {
  const { t } = useI18n();
  const ds = data.dataset ?? {};
  const rows = data.rows ?? [];
  const hist = data.histogram ?? [];
  const byRole = data.stats ?? [];
  const totalN = byRole.reduce((a, s) => a + (num(s.n) ?? 0), 0);
  // Headline statistics follow the outcome rows when there are any, because a
  // summary over conditions and outcomes mixed together is not a quantity.
  const primary =
    byRole.find((s) => s.role === "outcome") ??
    byRole.find((s) => s.role === "condition") ??
    byRole[0] ??
    {};
  const [dsName] = useTranslated([ds.name]);
  const name = dsName || fallbackKey;
  const stmts = useTranslatedClamped(rows.map((r) => r.statement || r.evidence_quote || ""), 120);

  const histPoints = hist.map((b) => ({
    x: `${fmt(b.lo)}-${fmt(b.hi)}`,
    y: b.n,
  }));

  return (
    <>
      <PageHead
        title={name}
        sub={`${fmt(totalN)} ${t("values")} · ${fmt(ds.document_count)} ${t("documents")}${
          ds.canonical_unit ? ` · ${ds.canonical_unit}` : ""
        }`}
        back={{ to: "/datasets", label: t("Back") }}
      />

      <div className="stat-row">
        <Stat label={t("Measurements")} value={totalN} sub={t("candidate values")} />
        <Stat label={t("Documents")} value={num(ds.document_count) ?? 0} sub={t("source reports")} />
        <Stat label={t("Min")} value={fmt(primary.min_value)} sub={ds.canonical_unit ?? ""} count={false} />
        <Stat label={t("Max")} value={fmt(primary.max_value)} sub={ds.canonical_unit ?? ""} count={false} />
        <Stat label={t("Mean")} value={fmt(primary.mean_value)} sub={t("sd {n}").replace("{n}", fmt(primary.sd_value))} count={false} />
        <Stat label={t("Median")} value={fmt(primary.median_value)} sub={t("middle value")} count={false} />
      </div>

      <div className="two-a">
        <Panel
          title={t("Distribution")}
          sub={t("{n} values · sd {sd}").replace("{n}", fmt(primary.n)).replace("{sd}", fmt(primary.sd_value))}
        >
          <Chart
            html={
              histPoints.length
                ? bars({
                    points: histPoints,
                    xLabel: ds.canonical_unit || t("value"),
                    yLabel: t("values"),
                    label: t("{name} distribution").replace("{name}", name),
                    unit: ds.canonical_unit ?? "",
                  })
                : null
            }
            emptyText={t("No chart available")}
          />
        </Panel>
        <Panel title={t("Statistics")} sub={ds.canonical_unit ?? t("not reported")}>
          <dl className="dl">
            <dt>{t("Measurements")}</dt>
            <dd className="mono2">{fmt(primary.n)}</dd>
            <dt>{t("Min")}</dt>
            <dd className="mono2">{fmt(primary.min_value)}</dd>
            <dt>{t("Max")}</dt>
            <dd className="mono2">{fmt(primary.max_value)}</dd>
            <dt>{t("Mean")}</dt>
            <dd className="mono2">{fmt(primary.mean_value)}</dd>
            <dt>{t("Median")}</dt>
            <dd className="mono2">{fmt(primary.median_value)}</dd>
            <dt>{t("Standard deviation")}</dt>
            <dd className="mono2">{fmt(primary.sd_value)}</dd>
          </dl>
        </Panel>
      </div>

      {byRole.length > 1 ? (
        <Panel title={t("By role")} sub={t("conditions and outcomes are counted separately")}>
          <div className="role-split">
            {byRole.map((s) => (
              <div className="role-split__row" key={String(s.role)}>
                <RoleTag role={s.role} />
                <span className="spacer" />
                <span className="small muted">
                  {fmt(s.n)} {t("values")} · {fmt(s.min_value)}-{fmt(s.max_value)} {ds.canonical_unit ?? ""}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel title={t("Measurements")} sub={`${fmt(rows.length)} ${t("rows")}`}>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th className="num">{t("Value")}</th>
                <th>{t("Unit")}</th>
                <th>{t("Role")}</th>
                <th>{t("Statement")}</th>
                <th>{t("Experiment")}</th>
                <th>{t("Source")}</th>
                <th className="num">{t("Confidence")}</th>
                <th>{t("Method")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r, i) => {
                  const v = num(r.value);
                  const vmax = num(r.value_max);
                  const ranged = vmax !== null && v !== null && vmax !== v;
                  return (
                    <tr key={String(r.finding_id ?? i)}>
                      <td className="num">
                        <b>{fmt(r.value)}</b>
                        {ranged ? `-${fmt(r.value_max)}` : ""}
                      </td>
                      <td>
                        {r.unit ?? ""}
                        {r.raw_unit && r.raw_unit !== r.unit ? (
                          <span className="muted small">
                            {" "}
                            ({t("raw {v} {u}").replace("{v}", r.raw_value != null ? String(r.raw_value) : "").replace("{u}", r.raw_unit)})
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <RoleTag role={r.role} />
                      </td>
                      <td className="small">{stmts[i]}</td>
                      <td>{r.experiment_code || r.experiment_name || "-"}</td>
                      <td>
                        <Link
                          className="doc-link"
                          to={`/explorer?id=${encodeURIComponent(String(r.document_id ?? ""))}`}
                        >
                          NTRS {String(r.document_source_id || r.document_id || "-")}
                        </Link>
                      </td>
                      <td className="num">{conf(r.confidence)}</td>
                      <td>
                        <span className="muted small">{r.extraction_method || "-"}</span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="empty">
                    {t("No results")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export default function Datasets() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const key = params.get("key");

  const list = useApi<DatasetsResponse>(key ? null : "/api/datasets");
  const detail = useApi<DetailResponse>(
    key ? `/api/datasets/${encodeURIComponent(key)}?limit=200` : null,
  );

  const active = key ? detail : list;
  const error = active.error;

  return (
    <AppShell subtitle={t("Measurements & Data")}>
      {error ? (
        <Empty icon="alert">{error}</Empty>
      ) : active.loading || !active.data ? (
        <section className="panel reveal">
          <Skeleton rows={4} />
        </section>
      ) : key ? (
        <DetailView data={detail.data as DetailResponse} fallbackKey={key} />
      ) : (
        <ListView data={list.data as DatasetsResponse} />
      )}
    </AppShell>
  );
}
