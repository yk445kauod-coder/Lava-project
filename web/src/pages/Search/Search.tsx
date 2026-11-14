import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { Empty, PageHead, Panel, Skeleton } from "../../components/Page";
import { apiGet } from "../../lib/api";
import { clamp, fmt, kindLabel } from "../../lib/format";
import { useTranslated } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

interface DocumentHit {
  id: unknown;
  source_id: string | null;
  title: string;
  kind: string | null;
  landing_url: string | null;
}

interface ExperimentHit {
  code: string;
  name: string | null;
  campaign: string | null;
  objective: string | null;
}

interface DatasetHit {
  key: string;
  name: string;
  canonical_unit: string | null;
  value_count: unknown;
}

interface FindingHit {
  id: unknown;
  metric: string | null;
  value: unknown;
  unit: string | null;
  statement: string | null;
  document_id: unknown;
  evidence_quote: string | null;
}

interface SearchResponse {
  query: string;
  experiments?: ExperimentHit[];
  datasets?: DatasetHit[];
  documents?: DocumentHit[];
  findings?: FindingHit[];
}

/** A results section: a titled panel with a count, rendered only when non-empty. */
function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <Panel title={title} sub={fmt(count)}>
        {children}
      </Panel>
    </div>
  );
}

export default function Search() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();

  const qParam = params.get("q") ?? "";
  const q = qParam.trim();

  const [text, setText] = useState(qParam);
  useEffect(() => setText(qParam), [qParam]);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexStats, setIndexStats] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (!q) {
      setData(null);
      setError(null);
      setLoading(false);
      apiGet<{ stats?: Record<string, unknown> }>("/api/stats")
        .then((d) => {
          const s = d.stats ?? {};
          const pick = (fields: string[]) =>
            fields.map((f) => Number(s[f]) || 0).reduce((a, b) => a + b, 0);
          setIndexStats({
            documents: pick(["documents", "docs", "document_count"]),
            experiments: pick(["experiments", "experiment_count"]),
            years: Number(s.years) || pick(["years"]) || 0,
            findings: pick(["findings", "findings_count"]),
          });
        })
        .catch(() => {});
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    apiGet<SearchResponse>(`/api/global-search?q=${encodeURIComponent(q)}`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [q]);

  const submit = (value: string) => {
    const v = value.trim();
    setParams(v ? { q: v } : {}, { replace: true });
  };

  const docs = data?.documents ?? [];
  const exps = data?.experiments ?? [];
  const datasets = data?.datasets ?? [];
  const findings = data?.findings ?? [];

  // Translate dynamic result content into the active language (data from the
  // corpus is English; the shell shows it translated in the chosen locale).
  const docTitles = useTranslated(docs.map((d) => d.title));
  const docKinds = useTranslated(docs.map((d) => kindLabel(d.kind)));
  const expNames = useTranslated(exps.map((x) => x.name));
  const expCampaigns = useTranslated(exps.map((x) => x.campaign));
  const expObjectives = useTranslated(exps.map((x) => x.objective));
  const dsNames = useTranslated(datasets.map((x) => x.name));
  const findingMetrics = useTranslated(findings.map((f) => f.metric));
  const findingStatements = useTranslated(findings.map((f) => f.statement || f.evidence_quote));

  const total = docs.length + exps.length + datasets.length + findings.length;

  return (
    <AppShell subtitle={t("Search")}>
      <PageHead title={t("Search")} sub={q ? `${t("results for")} "${q}"` : t("search the whole corpus")} />

      <div className="toolbar">
        <div className="field grow">
          <Icon name="search" size={14} />
          <input
            value={text}
            aria-label={t("Search documents, experiments, datasets, findings...")} placeholder={t("Search documents, experiments, datasets, findings...")}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(text);
            }}
          />
        </div>
        <button type="button" className="btn primary" onClick={() => submit(text)}>
          <Icon name="search" size={15} />
          {t("Search")}
        </button>
      </div>

      {!q ? (
        <>
          <div className="index-legend small muted" style={{ marginBottom: 14 }}>
            {t("Browse the corpus, or type a search above. Every dataset row feeds the retrieval index.")}
          </div>

          <Section title={t("Documents")} count={indexStats?.documents ?? 0}>
            <div className="index-cat">
              <Link className="index-card" to="/explorer">
                <Icon name="file" size={22} />
                <b>{t("Full-text corpus")}</b>
                <span className="small muted">{fmt(indexStats?.documents ?? 0)} {t("documents")}</span>
              </Link>
              <Link className="index-card" to="/datasets">
                <Icon name="database" size={22} />
                <b>{t("Measurements & Data")}</b>
                <span className="small muted">{t("Browse variables and PSI tables")}</span>
              </Link>
              <Link className="index-card" to="/experiments">
                <Icon name="flask" size={22} />
                <b>{t("Experiments")}</b>
                <span className="small muted">{fmt(indexStats?.experiments ?? 0)} {t("experiments")}</span>
              </Link>
            </div>
          </Section>
        </>
      ) : error ? (
        <Panel>
          <Empty icon="alert">{error}</Empty>
        </Panel>
      ) : loading || !data ? (
        <Panel>
          <Skeleton rows={4} />
        </Panel>
      ) : total === 0 ? (
        <Panel>
          <Empty icon="search">{t("No results")}</Empty>
        </Panel>
      ) : (
        <>
          <Section title={t("Documents")} count={docs.length}>
            {docs.map((x, i) => (
              <Link className="find" key={String(x.id)} to={`/explorer?id=${encodeURIComponent(String(x.id))}`}>
                <b>{docTitles[i] || x.title}</b>
                <div className="meta wrap">
                  <span className="cite">{x.source_id ? `NTRS ${x.source_id}` : ""}</span>
                  {x.kind && <span>{docKinds[i] || x.kind}</span>}
                </div>
              </Link>
            ))}
          </Section>

          <Section title={t("Experiments")} count={exps.length}>
            {exps.map((x, i) => (
              <Link className="find" key={x.code} to={`/experiments?code=${encodeURIComponent(x.code)}`}>
                <b>
                  {x.code} · {expNames[i] || x.name || ""}
                </b>
                <div className="meta wrap">
                  {x.campaign && <span className="cite">{expCampaigns[i] || x.campaign}</span>}
                  <span>{clamp(expObjectives[i] || x.objective || "", 100)}</span>
                </div>
              </Link>
            ))}
          </Section>

          <Section title={t("Datasets")} count={datasets.length}>
            {datasets.map((x, i) => (
              <Link className="find" key={x.key} to={`/datasets?key=${encodeURIComponent(x.key)}`}>
                <b>{dsNames[i] || x.name}</b>
                <div className="meta wrap">
                  {x.canonical_unit && <span className="cite">{x.canonical_unit}</span>}
                  <span>
                    {fmt(x.value_count)} {t("values")}
                  </span>
                </div>
              </Link>
            ))}
          </Section>

          <Section title={t("Findings")} count={findings.length}>
            {findings.map((x, i) => {
              const body = (
                <>
                  <div className="hstack wrap">
                    <span className="cite">{findingMetrics[i] || x.metric}</span>
                    <b>
                      {fmt(x.value)} {x.unit || ""}
                    </b>
                  </div>
                  <p className="small muted" style={{ marginTop: 5 }}>
                    {clamp(findingStatements[i] || x.statement || x.evidence_quote || "", 160)}
                  </p>
                </>
              );
              return x.document_id != null ? (
                <Link className="find" key={String(x.id)} to={`/explorer?id=${encodeURIComponent(String(x.document_id))}`}>
                  {body}
                </Link>
              ) : (
                <div className="find" key={String(x.id)}>
                  {body}
                </div>
              );
            })}
          </Section>
        </>
      )}
    </AppShell>
  );
}
