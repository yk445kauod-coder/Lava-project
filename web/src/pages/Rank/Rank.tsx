import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Chart } from "../../components/Chart";
import { Icon } from "../../components/Icon";
import { Empty, PageHead, Panel, Skeleton, Stat } from "../../components/Page";
import { apiGet } from "../../lib/api";
import { barList } from "../../lib/chart";
import { clamp, fmt, kindLabel, num } from "../../lib/format";
import { useTranslated, useTranslatedClamped } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

const DEFAULT_QUERY = "flame spread rate";

interface RankFactors {
  fusion?: unknown;
  coverage?: unknown;
  phrase?: unknown;
  provenance?: unknown;
  domain?: unknown;
  fusion_raw?: unknown;
  coverage_raw?: unknown;
  phrase_raw?: unknown;
  provenance_raw?: unknown;
  domain_raw?: unknown;
}

interface RankHit {
  pre_rank: unknown;
  title: string;
  source_id: string;
  section_path: string | null;
  kind: string | null;
  content: string;
  vector_score: unknown;
  keyword_score: unknown;
  fused_score: unknown;
  rerank_score: unknown;
  final_score: unknown;
  /** SI relevance score from the rerank stage, 0..1. */
  si_score?: unknown;
  /** The SI model's short reason for that score. */
  si_why?: string;
  factors?: RankFactors;
  /** Plain-language reason this passage ranked where it did. */
  why?: string;
  diversified: boolean;
}

interface RankWeights {
  fusion?: unknown;
  coverage?: unknown;
  phrase?: unknown;
  provenance?: unknown;
  domain?: unknown;
}

interface RankResponse {
  query?: string;
  retrieval_query?: string;
  k?: number;
  weights?: RankWeights;
  pool?: unknown;
  dropped?: unknown;
  latency_ms?: unknown;
  verdict?: string;
  grade_score?: unknown;
  hits?: RankHit[];
}

type ScoreKey = "final_score" | "rerank_score" | "vector_score" | "keyword_score";

/** The factors that make up a final score, in display order. */
const FACTOR_KEYS = ["fusion", "coverage", "phrase", "provenance", "domain"] as const;

/** A 0..1 score to three decimals, or an em dash when not reported. */
function score3(v: unknown): string {
  const n = num(v);
  return n === null ? "-" : n.toFixed(3);
}

/** Single-line label for a chart bar. */
function shortTitle(s: string): string {
  return clamp(String(s || "").replace(/\s+/g, " "), 46);
}

/** The top `n` hits by one score, as bar-list items, keeping the source index
 *  so the caller can supply a translated label for each. */
function topBy(hits: RankHit[], key: ScoreKey, n = 10): { idx: number; value: number }[] {
  return hits
    .map((h, idx) => ({ idx, value: num(h[key]) }))
    .filter((r) => r.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, n)
    .map((r) => ({ idx: r.idx, value: r.value as number }));
}

function ScoreChart({
  hits,
  labels,
  scoreKey,
  loading,
}: {
  hits: RankHit[];
  labels: string[];
  scoreKey: ScoreKey;
  loading: boolean;
}) {
  if (loading) return <Skeleton rows={3} />;
  const items = topBy(hits, scoreKey).map((r) => ({ label: labels[r.idx] || shortTitle(hits[r.idx].title), value: r.value }));
  return <Chart html={items.length ? barList(items, { unit: "" }) : null} />;
}

/** One row's score, split into the weighted signals that produced it. */
function FactorBar({ factors }: { factors?: RankFactors }) {
  if (!factors) return null;
  const parts = FACTOR_KEYS.map((k) => ({ k, v: num(factors[k]) ?? 0 }));
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  return (
    <div className="hstack" style={{ marginTop: 7, gap: 4, alignItems: "center" }}>
      <div className="bar-track" style={{ flex: 1, height: 6, display: "flex" }} title={parts
        .map((p) => `${p.k} ${fmt(p.v)}`)
        .join(" · ")}>
        {parts.map((p) => (
          <i key={p.k} className={`fx-${p.k}`} style={{ width: `${((p.v / total) * 100).toFixed(1)}%`, height: "100%" }} />
        ))}
      </div>
    </div>
  );
}

export default function Rank() {
  const { t } = useI18n();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [data, setData] = useState<RankResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const run = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const id = ++reqRef.current;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const d = await apiGet<RankResponse>(`/api/rank?q=${encodeURIComponent(q)}&k=12`);
      if (id === reqRef.current) setData(d);
    } catch (e) {
      if (id === reqRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(DEFAULT_QUERY);
  }, [run]);

  const hits = data?.hits ?? [];
  const kept = hits.filter((h) => h.diversified).length;
  const w = data?.weights ?? {};
  const hitTitleT = useTranslatedClamped(hits.map((h) => h.title), 70);
  const hitKindT = useTranslated(hits.map((h) => kindLabel(h.kind)));
  const hitWhyT = useTranslated(hits.map((h) => h.why ?? ""));
  const hitSiWhyT = useTranslated(hits.map((h) => h.si_why ?? ""));
  const hitBodyT = useTranslatedClamped(hits.map((h) => h.content ?? ""), 150);
  const chartLabels = useTranslatedClamped(hits.map((h) => h.title), 46);

  return (
    <AppShell subtitle={t("Smart Ranking")}>
      <PageHead
        title={t("Smart Ranking")}
        sub={t("hybrid retrieval → rerank → domain boost → MMR diversification, every score visible")}
      />

      <div className="toolbar">
        <div className="field grow">
          <Icon name="rank" size={14} />
          <input
            value={query}
            placeholder={t("Query to rank, e.g. flame spread rate")}
            autoComplete="off"
            aria-label={t("Query to rank")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run(query);
            }}
          />
        </div>
        <button className="btn primary" type="button" onClick={() => void run(query)} disabled={loading}>
          <Icon name="arrowRight" size={16} /> {t("Rank")}
        </button>
      </div>

      {error ? (
        <Panel>
          <Empty icon="alert">{error}</Empty>
        </Panel>
      ) : (
        <>
          {data && (
            <div className="stat-row">
              <Stat
                label={t("Verdict")}
                value={data.verdict ? t(data.verdict) : "-"}
                sub={`${t("grade")} ${fmt(data.grade_score)}`}
                count={false}
              />
              <Stat
                label={t("Candidate pool")}
                value={num(data.pool) ?? 0}
                sub={t("retrieved before rerank")}
              />
              <Stat
                label={t("Dropped as off-topic")}
                value={num(data.dropped) ?? 0}
                sub={t("did not contain enough of the question")}
              />
              <Stat label={t("Selected")} value={kept} sub={t("after MMR diversification")} />
              <Stat
                label={t("Latency")}
                value={`${fmt(data.latency_ms)} ms`}
                sub={`${t("fusion")} ${fmt(w.fusion)} · ${t("coverage")} ${fmt(w.coverage)} · ${t("phrase")} ${fmt(w.phrase)} · ${t("provenance")} ${fmt(w.provenance)} · ${t("domain")} ${fmt(w.domain)}`}
                count={false}
              />
            </div>
          )}

          {data?.retrieval_query && data.retrieval_query !== data.query && (
            <p className="small muted" style={{ marginTop: -6 }}>
              {t("Searched the English corpus as")}: <span dir="ltr">{data.retrieval_query}</span>
            </p>
          )}

          <Panel title={t("How ranking works")}>
            <p className="small muted" style={{ margin: 0 }}>
              {t("Each passage is scored on five signals: how well it matched in retrieval, how much of your wording it contains, whether your terms appear together, the quality and recency of the source, and how much combustion vocabulary it carries. The bar under each row shows the mix. Passages that share too little of your question are dropped before ranking, so an off-topic question returns nothing rather than a page of near-misses.")}
            </p>
          </Panel>

          <div className="two-a">
            <Panel title={t("Final score")} sub={t("weighted blend of every signal")}>
              <ScoreChart hits={hits} labels={chartLabels} scoreKey="final_score" loading={loading} />
            </Panel>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <Panel title={t("Vector score")} sub={t("dense similarity")}>
                <ScoreChart hits={hits} labels={chartLabels} scoreKey="vector_score" loading={loading} />
              </Panel>
              <Panel title={t("Keyword score")} sub={t("lexical match")}>
                <ScoreChart hits={hits} labels={chartLabels} scoreKey="keyword_score" loading={loading} />
              </Panel>
            </div>
          </div>

          <Panel
            title={t("Ranked passages")}
            sub={data ? `${fmt(hits.length)} ${t("scored passages")}` : ""}
          >
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>{t("Passage")}</th>
                    <th className="num">{t("final")}</th>
                    <th className="num">{t("vector")}</th>
                    <th className="num">{t("keyword")}</th>
                    <th className="num">{t("fused")}</th>
                    <th className="num">{t("rerank")}</th>
                    <th className="num">{t("SI")}</th>
                    <th>{t("kept")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9} className="empty">
                        <span className="spin" /> {t("ranking...")}
                      </td>
                    </tr>
                  ) : hits.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="empty">
                        {t("No passages")}
                      </td>
                    </tr>
                  ) : (
                    hits.slice(0, 40).map((h, i) => (
                      <tr key={`${h.source_id}-${String(h.pre_rank)}-${i}`}>
                        <td className="num">{fmt(h.pre_rank)}</td>
                        <td>
                          <b className="small">{hitTitleT[i] || clamp(h.title, 70)}</b>
                          {hitWhyT[i] && (
                            <div className="small" style={{ marginTop: 3 }}>{hitWhyT[i]}</div>
                          )}
                          {hitSiWhyT[i] && (
                            <div className="small" style={{ marginTop: 3 }}>{t("SI")}: {hitSiWhyT[i]}</div>
                          )}
                          <div className="small muted" style={{ marginTop: 3 }}>
                            {hitBodyT[i]}
                          </div>
                          <div className="small muted" style={{ marginTop: 3 }}>
                            NTRS {h.source_id} · {h.section_path || hitKindT[i] || h.kind || ""}
                          </div>
                          <FactorBar factors={h.factors} />
                        </td>
                        <td className="num"><b>{score3(h.final_score)}</b></td>
                        <td className="num">{score3(h.vector_score)}</td>
                        <td className="num">{score3(h.keyword_score)}</td>
                        <td className="num">{score3(h.fused_score)}</td>
                        <td className="num">{score3(h.rerank_score)}</td>
                        <td className="num">{score3(h.si_score)}</td>
                        <td>{h.diversified ? <span className="muted">{t("selected")}</span> : ""}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
