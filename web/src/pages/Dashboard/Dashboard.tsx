import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { Chart } from "../../components/Chart";
import { Count } from "../../components/Count";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { Ring } from "../../components/Ring";
import { apiGet, apiPost } from "../../lib/api";
import { bars, barList, donut, line } from "../../lib/chart";
import { categoryLabel, fmt, kindLabel, num, pct } from "../../lib/format";
import { postSse } from "../../lib/sse";
import { STAGE_LABEL, STOP_LABEL, stageDetail } from "../../lib/agentStages";
import { useTranslated } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

interface StatsResponse {
  stats?: Record<string, unknown>;
  byYear?: { year: unknown; n: unknown }[];
  byKind?: { kind: string; n: unknown }[];
  topMetrics?: { metric: string; n: unknown; min_value: unknown; max_value: unknown; unit?: string }[];
  metrics?: { metric: string; n: unknown }[];
}

interface Experiment {
  code: string;
  name?: string;
  campaign?: string;
  o2_fraction?: unknown;
  pressure_kpa?: unknown;
  status?: string;
}

interface Insight {
  id?: string;
  slug?: string;
  title: string;
  severity?: string;
  category?: string;
  supporting_documents?: unknown[];
}

interface AskResult {
  answer?: string;
  stop_reason?: string;
  confidence?: unknown;
  evidence?: unknown[];
}

const PROMPTS = [
  "What governs flame spread in microgravity?",
  "How does oxygen concentration affect ignition limits?",
  "Summarize soot and smoke measurements from ISS experiments",
  "What are the fire-safety implications for spacecraft materials?",
];

function Stat({ label, value, sub }: { label: string; value: unknown; sub: string }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="n">
        <Count value={value} />
      </div>
      <div className="s">{sub}</div>
    </div>
  );
}

function AskPanel() {
  const { t } = useI18n();
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<{ label: string; detail: string }[]>([]);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    const q = question.trim();
    if (!q || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setLog([]);
    try {
      await postSse(
        "/api/ask",
        { question: q, k: 8, stream: true, mode: "fast", conversation_id: crypto.randomUUID() },
        (raw) => {
          const ev = raw as { event?: string; data?: Record<string, unknown> };
          if (ev.event === "error") setError(String(ev.data?.error ?? "agent error"));
          else if (ev.event === "done") setResult(ev.data as AskResult);
          else if (ev.event && STAGE_LABEL[ev.event]) {
            const label = STAGE_LABEL[ev.event];
            const detail = stageDetail(ev.event, ev.data ?? {}, t);
            setLog((l) => [...l, { label, detail }]);
          }
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const complete = result?.stop_reason === "final_answer" || result?.stop_reason === "forced_synthesis";

  return (
    <>
      <section className="panel reveal">
        <div className="panel-h">
          <h2>{t("Ask LAVA Intelligence")}</h2>
          <small>{t("Ask a question, get an answer grounded in the corpus")}</small>
        </div>
        <div style={{ padding: "16px 18px 18px" }}>
          <div className="hstack wrap" style={{ marginBottom: 12 }}>
            {PROMPTS.map((p) => (
              <button key={p} className="chip" type="button" onClick={() => setQuestion(p)}>
                {t(p)}
              </button>
            ))}
          </div>
          <div className="field" style={{ paddingRight: 6 }}>
            <Icon name="sparkles" size={16} />
            <input
              aria-label={t("Ask a research question...")} placeholder={t("Ask a research question...")}
              autoComplete="off"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
            />
            <button className="btn primary sm" type="button" onClick={ask} disabled={running}>
              {running ? t("Running...") : t("Ask")}
            </button>
          </div>
          {error && (
            <div className="empty">
              {t("LAVA Intelligence error")}: {error}
            </div>
          )}
          {result && (
            <>
              <Markdown html={String(result.answer ?? "")} />
              <div className="meta" style={{ marginTop: 10 }}>
                <span className={`pill ${complete ? "ok" : "run"}`}>{t(STOP_LABEL[result.stop_reason ?? ""] || result.stop_reason || "") || "-"}</span>
                <Ring value={result.confidence} />
                <span className="cite">
                  {fmt((result.evidence ?? []).length)} {t("sources")}
                </span>
                <Link className="doc-link" to={`/chat?q=${encodeURIComponent(question)}`}>
                  {t("Open in LAVA Intelligence")} →
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
      <section className="panel reveal">
        <div className="panel-h">
          <h2>{t("LAVA Intelligence pipeline")}</h2>
          <small>{t("live stage log")}</small>
        </div>
        <div id="pipeline">
          {log.map((l, i) => (
            <div className="log-row" key={i}>
              <span className="sev" />
              <div>
                <b>{t(l.label)}</b> <span className="muted small">{l.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [metric, setMetric] = useState("");
  const [metricSpec, setMetricSpec] = useState<{
    points: { x: string | number; y: unknown }[];
    yLabel: string;
    xLabel: string;
    unit: string;
  } | null>(null);
  const [metricError, setMetricError] = useState<string | null>(null);
  const loading = !data && !statsError;

  useEffect(() => {
    apiGet<StatsResponse>("/api/stats")
      .then(setData)
      .catch((e: unknown) => setStatsError(e instanceof Error ? e.message : String(e)));
    apiGet<{ experiments: Experiment[] }>("/api/experiments?limit=8")
      .then((d) => setExperiments(d.experiments ?? []))
      .catch(() => setExperiments([]));
    apiGet<{ insights: Insight[] }>("/api/insights")
      .then((d) => setInsights((d.insights ?? []).slice(0, 5)))
      .catch(() => setInsights([]));
  }, []);

  const st = data?.stats ?? {};
  // Translate dynamic content (experiment rows, document kinds, telemetry
  // metric names) into the active language. Values render in English until a
  // translation lands, then re-render in the chosen locale.
  const expNameT = useTranslated(experiments.map((x) => x.name));
  const expCampT = useTranslated(experiments.map((x) => x.campaign));
  const expStatT = useTranslated(experiments.map((x) => x.status));
  const kindT = useTranslated((data?.byKind ?? []).map((r) => kindLabel(r.kind)));
  const topMetricT = useTranslated((data?.topMetrics ?? []).map((m) => m.metric));
  const optMetricT = useTranslated((data?.metrics ?? []).map((m) => m.metric).concat((data?.topMetrics ?? []).slice(0, 8).map((m) => m.metric)));
  const insightT = useTranslated(insights.map((x) => x.title));
  const insightCatT = insights.map((x) => t(categoryLabel(x.category)));

  const years = useMemo(
    () =>
      (data?.byYear ?? [])
        .filter((r) => num(r.year) !== null)
        .map((r) => ({ x: num(r.year) as number, y: num(r.n) ?? 0 })),
    [data],
  );
  const kinds = useMemo(
    () => (data?.byKind ?? []).map((r, i) => ({ label: kindT[i] || r.kind || "other", value: num(r.n) ?? 0 })),
    [data, kindT],
  );
  const top = useMemo(() => (data?.topMetrics ?? []).slice(0, 8), [data]);
  const topLabels = useMemo(
    () => top.map((m, i) => topMetricT[i] || m.metric),
    [top, topMetricT],
  );
  const metricOptions = useMemo(
    () => (data?.metrics ?? []).length ? data!.metrics! : top.map((m) => ({ metric: m.metric, n: m.n })),
    [data, top],
  );
  const metricOptionLabels = useMemo(
    () => metricOptions.map((m, i) => optMetricT[i] || m.metric),
    [metricOptions, optMetricT],
  );

  // Choose a headline telemetry metric once stats arrive, preferring the
  // quantities the Mission Overview strip is named after.
  useEffect(() => {
    if (metric || !top.length) return;
    const preferred = top.find((m) => /spread|temperature|pressure/.test(m.metric)) || top[0];
    setMetric(preferred.metric);
  }, [top, metric]);

  useEffect(() => {
    if (!metric) return;
    let alive = true;
    setMetricSpec(null);
    setMetricError(null);
    apiPost<{ spec?: { series?: { points?: { x: unknown; y: unknown }[] }[]; y_label?: string; x_label?: string; unit?: string } }>(
      "/api/visualize",
      { dataset: metric, type: "bar", limit: 14 },
    )
      .then((d) => {
        if (!alive) return;
        setMetricSpec({
          points: (d.spec?.series?.[0]?.points ?? []).map((p) => ({ x: p.x as string | number, y: p.y })),
          yLabel: d.spec?.y_label || metric,
          xLabel: d.spec?.x_label || "",
          unit: d.spec?.unit || "",
        });
      })
      .catch((e: unknown) => alive && setMetricError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [metric]);

  // Axis labels come from the worker in English; translate them with the metric
  // name so an Arabic view does not show English text inside the chart.
  const metricLabelT = useTranslated(
    metricSpec ? [metricSpec.yLabel, metricSpec.xLabel, metric] : [],
  );
  const metricHtml = metricSpec
    ? bars({
        points: metricSpec.points,
        yLabel: metricLabelT[0] || metricSpec.yLabel,
        xLabel: metricLabelT[1] || metricSpec.xLabel,
        unit: metricSpec.unit,
        label: `${metricLabelT[2] || metric} ${t("distribution")}`,
      })
    : null;

  const totalYears = years.reduce((a, r) => a + r.y, 0);

  return (
    <AppShell subtitle={t("Mission Overview")}>
      <div className="page-head">
        <div className="grow">
          <h1>{t("Mission Overview")}</h1>
        </div>
        <div className="hstack wrap muted small">
          <Icon name="database" size={14} /> {loading ? "..." : fmt(st.documents)} {t("documents")}
          <span aria-hidden="true">·</span>
          <Icon name="layers" size={14} /> {loading ? "..." : fmt(st.chunks)} {t("passages")}
        </div>
      </div>

      {statsError ? (
        <div className="stat">
          <div className="k">{t("Backend")}</div>
          <div className="n" style={{ fontSize: 18 }}>{t("unreachable")}</div>
          <div className="s">{statsError}</div>
        </div>
      ) : loading ? (
        <div className="stat-row">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="stat" key={i}>
              <div className="skel w40" />
              <div className="skel lg w60" />
              <div className="skel w60" />
            </div>
          ))}
        </div>
      ) : (
        <div className="stat-row">
          <Stat label={t("Documents")} value={st.documents} sub={`${fmt(st.documents_with_fulltext)} ${t("with full text")}`} />
          <Stat label={t("Indexed passages")} value={st.chunks} sub={`${fmt(st.embeddings)} ${t("also vector-searchable")}`} />
          <Stat label={t("Extracted findings")} value={st.findings} sub={`${fmt(st.experiments)} ${t("experiments")}`} />
          <Stat label={t("Corpus size")} value={st.corpus_words} sub={t("words of source text")} />
        </div>
      )}

      <div className="two-a">
        <section className="panel reveal">
          <div className="panel-h">
            <h2>{t("Corpus growth")}</h2>
            <small>
              {years.length
                ? `${fmt(totalYears)} ${t("dated documents")} · ${years[0].x}-${years[years.length - 1].x}`
                : t("documents published per year")}
            </small>
          </div>
          <Chart
            html={
              years.length
                ? line({ points: years, xLabel: t("year published"), yLabel: t("documents"), label: t("Documents published per year") })
                : null
            }
            loading={loading}
          />
        </section>
        <section className="panel reveal">
          <div className="panel-h">
            <h2>{t("Document mix")}</h2>
            <small>{kinds.length ? `${kinds.length} ${t("record types")}` : t("by record type")}</small>
          </div>
          <Chart
            html={
              kinds.length
                ? donut({
                    slices: kinds,
                    center: fmt(kinds.reduce((a, k) => a + k.value, 0)),
                    centerSub: t("documents"),
                    label: t("Documents by record type"),
                  })
                : null
            }
            loading={loading}
          />
        </section>
      </div>

      <div className="two-a">
        <section className="panel reveal">
          <div className="panel-h">
            <h2>{t("Metric distribution")}</h2>
            <select id="metric" className="chip" aria-label={t("Metric to chart")} value={metric} onChange={(e) => setMetric(e.target.value)}>
              {metricOptions.map((m, i) => (
                <option key={m.metric} value={m.metric}>
                  {metricOptionLabels[i] || m.metric} ({fmt(m.n)})
                </option>
              ))}
            </select>
          </div>
          {metricError ? (
            <div className="empty">{metricError}</div>
          ) : (
            <Chart html={metricHtml} loading={loading || !metricHtml} />
          )}
        </section>
        <section className="panel reveal">
          <div className="panel-h">
            <h2>{t("Top metrics")}</h2>
            <small>{t("most-measured quantities")}</small>
          </div>
          <Chart
            html={
              top.length
                ? barList(
                    top.map((m, i) => ({
                      label: topLabels[i] || m.metric,
                      value: m.n,
                      sub: `${fmt(m.min_value)}-${fmt(m.max_value)}${m.unit ? " " + m.unit : ""}`,
                    })),
                    { unit: t("values") },
                  )
                : null
            }
            loading={loading}
          />
        </section>
      </div>

      <div className="two-a">
        <section className="panel reveal">
          <div className="panel-h">
            <h2>{t("Experiments")}</h2>
            <Link className="small doc-link" to="/experiments">
              {t("Open Experiments")} →
            </Link>
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("Code")}</th>
                  <th>{t("Experiment")}</th>
                  <th>{t("Campaign")}</th>
                  <th>O₂</th>
                  <th>{t("Pressure")}</th>
                  <th>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {experiments.length ? (
                  experiments.map((x, i) => (
                    <tr key={x.code} onClick={() => navigate(`/experiments?code=${encodeURIComponent(x.code)}`)}>
                      <td className="id">{x.code}</td>
                      <td>{expNameT[i] || x.name || "-"}</td>
                      <td>{expCampT[i] || x.campaign || "-"}</td>
                      <td className="num">{x.o2_fraction != null ? pct(x.o2_fraction) : t("not reported")}</td>
                      <td className="num">{x.pressure_kpa != null ? `${fmt(x.pressure_kpa)} kPa` : t("not reported")}</td>
                      <td>
                        <span className={`pill ${x.status === "active" ? "ok" : "run"}`}>{expStatT[i] || x.status || "-"}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="empty">
                      {t("No experiments")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel reveal">
          <div className="panel-h">
            <h2>{t("Fire-safety findings")}</h2>
            <Link className="small doc-link" to="/insights">
              {t("All insights")} →
            </Link>
          </div>
          {insights.length ? (
            insights.map((i, idx) => (
              <Link className="find" key={i.slug || i.id || i.title} to={`/insights#${i.slug || i.id}`}>
                <b>{insightT[idx] || i.title}</b>
                <div className="meta">
                  <span>{insightCatT[idx] || i.category || ""}</span>
                  <span className="spacer" />
                  <span>
                    {fmt((i.supporting_documents || []).length)} {t("sources")}
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <div className="empty">{t("No findings")}</div>
          )}
        </section>
      </div>

      <div className="two-a">
        <AskPanel />
      </div>
    </AppShell>
  );
}
