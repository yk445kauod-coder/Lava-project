import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { Empty, PageHead, Panel, Skeleton, Stat } from "../../components/Page";
import { fmt, kindLabel, num } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import { useTranslated, useTranslatedClamped } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

const PER = 24;
const KINDS: { value: string; label: string }[] = [
  { value: "", label: "All kinds" },
  { value: "report", label: "Report" },
  { value: "conference_paper", label: "Conference paper" },
  { value: "journal_article", label: "Journal article" },
  { value: "technical_memo", label: "Technical memo" },
  { value: "other", label: "Other" },
];

interface DocumentRow {
  id: number;
  source_id: string;
  title: string;
  kind: string | null;
  abstract: string | null;
  authors?: string[];
  published_date?: string;
  word_count: number;
  quality_score: number | null;
  has_fulltext: boolean;
  landing_url: string | null;
  chunks: number;
}

interface DocumentsResponse {
  documents: DocumentRow[];
  total: number;
  limit: number;
  offset: number;
}

interface DocumentDetail {
  id: number;
  source: string;
  source_id: string;
  kind: string | null;
  title: string;
  abstract: string | null;
  authors: string[];
  report_numbers: string[];
  center: string | null;
  distribution: string | null;
  keywords: string[] | string | null;
  subject_categories: unknown;
  published_date: string | null;
  word_count: number;
  char_count: number;
  quality_score: number | null;
  landing_url: string | null;
}

interface Chunk {
  id: number;
  ordinal: number;
  kind: string;
  section_path: string | null;
  token_count: number;
  preview: string | null;
  embedded: boolean;
}

interface Finding {
  id: number;
  metric: string;
  value: unknown;
  value_max: unknown;
  unit: string | null;
  statement: string | null;
  confidence: unknown;
  extraction_method?: string | null;
  evidence_quote: string | null;
}

interface DocExperiment {
  code: string;
  name: string | null;
  relation: string | null;
}

interface DocumentResponse {
  document: DocumentDetail;
  chunks: Chunk[];
  findings: Finding[];
  experiments: DocExperiment[];
}

type ApiState<T> = { data: T | null; loading: boolean; error: string | null };

/** Two-decimal display for a 0..1 quality score (numbers may arrive as strings). */
function q2(v: unknown): string {
  const n = num(v);
  return n === null ? "-" : n.toFixed(2);
}

/** Keywords arrive as either an array or a single delimited string. */
function keywordsOf(k: string[] | string | null | undefined): string[] {
  if (Array.isArray(k)) return k.map((s) => String(s)).filter(Boolean);
  if (typeof k === "string" && k.trim()) {
    return k
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

const date10 = (d: string | null | undefined): string => (d ? String(d).slice(0, 10) : "");

function List({
  q,
  kind,
  experiment,
  offset,
  setOffset,
  onSearch,
  onKind,
  onOpen,
  api,
}: {
  q: string;
  kind: string;
  experiment: string;
  offset: number;
  setOffset: (n: number) => void;
  onSearch: (v: string) => void;
  onKind: (k: string) => void;
  onOpen: (id: number) => void;
  api: ApiState<DocumentsResponse>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);

  const listed = api.data?.documents ?? [];
  const docTitles = useTranslatedClamped(listed.map((d) => d.title), 110);
  const docAbstracts = useTranslatedClamped(listed.map((d) => d.abstract ?? ""), 140);
  const docKinds = useTranslated(listed.map((d) => kindLabel(d.kind)));

  const total = api.data?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + PER, total);
  const sub = api.data
    ? `${fmt(total)} ${t("documents")}${experiment ? ` · ${experiment}` : ""}${q ? ` · "${q}"` : ""}`
    : t("NASA NTRS combustion literature");

  return (
    <>
      <PageHead title={t("Source Documents")} sub={sub}>
        <div className="field" style={{ minWidth: 240 }}>
          <Icon name="search" size={14} />
          <input
            placeholder={t("Search titles and full text")}
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearch(text.trim());
            }}
          />
        </div>
      </PageHead>

      <div className="toolbar">
        <div className="hstack wrap">
          {KINDS.map((k) => (
            <button
              key={k.value || "all"}
              type="button"
              className={`chip ${k.value === kind ? "on" : ""}`}
              onClick={() => onKind(k.value)}
            >
              {t(k.label)}
            </button>
          ))}
        </div>
      </div>

      <Panel>
        {api.error ? (
          <Empty icon="alert">{api.error}</Empty>
        ) : api.loading || !api.data ? (
          <Skeleton rows={4} />
        ) : api.data.documents.length === 0 ? (
          <Empty icon="search">{t("No documents")}</Empty>
        ) : (
          <>
            <div className="tbl-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("Title")}</th>
                    <th>{t("Kind")}</th>
                    <th className="num">{t("Words")}</th>
                    <th className="num">{t("Passages")}</th>
                    <th className="num">{t("Quality")}</th>
                  </tr>
                </thead>
                <tbody>
                  {api.data.documents.map((doc, di) => {
                    const score = num(doc.quality_score);
                    return (
                      <tr key={doc.id} onClick={() => onOpen(doc.id)} style={{ cursor: "pointer" }}>
                        <td>
                          <Link
                            className="doc-link"
                            to={`/explorer?id=${doc.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {docTitles[di]}
                          </Link>
                          <div className="small muted" style={{ marginTop: 3 }}>
                            {docAbstracts[di]}
                          </div>
                        </td>
                        <td>
                          <span className="muted">{docKinds[di] || "-"}</span>
                        </td>
                        <td className="num">{fmt(doc.word_count)}</td>
                        <td className="num">{fmt(doc.chunks)}</td>
                        <td className="num">
                          {score !== null ? (
                            <span className="hstack" style={{ justifyContent: "flex-end", gap: 8 }}>
                              <span className="bar-track" style={{ width: 56, height: 6 }}>
                                <i style={{ width: `${Math.min(100, score * 100)}%` }} />
                              </span>
                              {q2(doc.quality_score)}
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <button type="button" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - PER))}>
                ← {t("Prev")}
              </button>
              <span className="muted small">
                {fmt(from)}-{fmt(to)} {t("of")} {fmt(total)}
              </span>
              <button type="button" disabled={to >= total} onClick={() => setOffset(offset + PER)}>
                {t("Next")} →
              </button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

function Detail({ api, backTo }: { api: ApiState<DocumentResponse>; backTo: string }) {
  const { t } = useI18n();

  if (api.error) {
    return (
      <>
        <PageHead title={t("Source Documents")} back={{ to: backTo, label: t("Back") }} />
        <Empty icon="alert">{api.error}</Empty>
      </>
    );
  }
  if (!api.data?.document) {
    return (
      <Panel>
        <Skeleton rows={5} />
      </Panel>
    );
  }

  const doc = api.data.document;
  const chunks = api.data.chunks ?? [];
  const chunkKinds = useTranslated(chunks.map((c) => kindLabel(c.kind)));
  const findings = api.data.findings ?? [];
  const exps = api.data.experiments ?? [];
  const embedded = chunks.filter((c) => c.embedded).length;
  const kws = keywordsOf(doc.keywords);
  const date = date10(doc.published_date);
  const authors = doc.authors ?? [];
  const reportNumbers = doc.report_numbers ?? [];
  const [docTitleT, docAbstractT] = useTranslated([doc.title, doc.abstract]);
  const docTitle = docTitleT || doc.source_id || "";
  const docAbstract = docAbstractT ?? doc.abstract;
  const [kindT] = useTranslated([kindLabel(doc.kind)]);

  return (
    <>
      <PageHead
        title={docTitle}
        sub={`${doc.source || "NTRS"} · ${kindT || "-"}${date ? " · " + date : ""}`}
        back={{ to: backTo, label: t("Back") }}
      >
        {doc.landing_url && (
          <a className="btn ghost" href={doc.landing_url} target="_blank" rel="noreferrer">
            <Icon name="external" size={16} /> {t("Open on NTRS")}
          </a>
        )}
      </PageHead>

      <div className="stat-row">
        <Stat label={t("Words")} value={doc.word_count} sub={`${fmt(doc.char_count)} ${t("characters")}`} />
        <Stat label={t("Passages")} value={chunks.length} sub={`${fmt(embedded)} ${t("embedded")}`} />
        <Stat label={t("Findings")} value={findings.length} sub={t("extracted measurements")} />
        <Stat
          label={t("Quality")}
          value={q2(doc.quality_score)}
          sub={t("extraction quality score")}
          count={false}
        />
      </div>

      <div className="two-a">
        <Panel title={t("Metadata")}>
          <dl className="dl">
            <dt>{t("Source")}</dt>
            <dd>
              {doc.source || "NTRS"} · <span className="mono2">{doc.source_id}</span>
            </dd>
            <dt>{t("Kind")}</dt>
            <dd>
              {doc.kind || "-"}
              {date ? " · " + date : ""}
            </dd>
            <dt>{t("Authors")}</dt>
            <dd>{authors.length ? authors.join(", ") : t("not reported")}</dd>
            {reportNumbers.length > 0 && (
              <>
                <dt>{t("Report no.")}</dt>
                <dd className="mono2">{reportNumbers.join(", ")}</dd>
              </>
            )}
            {exps.length > 0 && (
              <>
                <dt>{t("Experiments")}</dt>
                <dd>
                  {exps.map((e, i) => (
                    <Fragment key={e.code}>
                      {i > 0 && ", "}
                      <Link className="doc-link" to={`/experiments?code=${encodeURIComponent(e.code)}`}>
                        {e.code}
                      </Link>
                    </Fragment>
                  ))}
                </dd>
              </>
            )}
          </dl>
          {doc.abstract && (
            <div style={{ padding: "0 18px 18px" }}>
              <div className="lbl">{t("Abstract")}</div>
              <p style={{ marginTop: 6 }}>{docAbstract}</p>
            </div>
          )}
          {kws.length > 0 && (
            <div className="small muted" style={{ padding: "0 18px 18px" }}>
              {kws.slice(0, 14).join(" · ")}
            </div>
          )}
        </Panel>

        <Panel
          title={t("Findings in this document")}
          sub={`${fmt(findings.length)} ${t("extracted")} · ${t("machine-extracted, not hand-verified")}`}
        >
          {findings.length ? (
            findings.map((f) => (
              <div className="find" key={f.id}>
                <div className="hstack wrap">
                  <b>{t(f.metric || "")}</b>
                  <b>
                    {f.value != null ? fmt(f.value) : ""}
                    {f.value_max != null && f.value_max !== f.value ? "-" + fmt(f.value_max) : ""} {f.unit || ""}
                  </b>
                  <span className="spacer" />
                  {f.extraction_method && <span className="small muted">{f.extraction_method}</span>}
                  {f.confidence != null && (
                    <span className="small muted">
                      {t("confidence")} {q2(f.confidence)}
                    </span>
                  )}
                </div>
                {f.evidence_quote && (
                  <blockquote className="small muted quote">"{f.evidence_quote}"</blockquote>
                )}
              </div>
            ))
          ) : (
            <Empty icon="info">{t("No findings extracted")}</Empty>
          )}
        </Panel>
      </div>

      <Panel
        title={t("Passages")}
        sub={`${fmt(chunks.length)} ${t("chunks")} · ${fmt(embedded)} ${t("embedded")}`}
        className="panel reveal"
      >
        {chunks.length ? (
          chunks.map((c, ci) => (
            <div className="find" key={c.id}>
              <div className="hstack">
                <span className="cite">#{c.ordinal}</span>
                <span className="small muted">{c.section_path || chunkKinds[ci] || ""}</span>
                <span className="spacer" />
                <span className="muted small">
                  {fmt(c.token_count)} {t("tok")}
                  {c.embedded ? ` · ${t("embedded")}` : ""}
                </span>
              </div>
              <p className="small" style={{ marginTop: 6, color: "var(--muted)" }}>
                {c.preview || ""}
              </p>
            </div>
          ))
        ) : (
          <Empty icon="layers">{t("No passages")}</Empty>
        )}
      </Panel>
    </>
  );
}

export default function Explorer() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const id = params.get("id");
  const q = params.get("q") ?? "";
  const kind = params.get("kind") ?? "";
  const experiment = params.get("experiment") ?? "";

  const [offset, setOffset] = useState(0);
  const filterKey = `${q}\u0000${kind}\u0000${experiment}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) {
    setLastKey(filterKey);
    setOffset(0);
  }

  const listPath = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PER), offset: String(offset) });
    if (q) p.set("q", q);
    if (kind) p.set("kind", kind);
    if (experiment) p.set("experiment", experiment);
    return `/api/documents?${p.toString()}`;
  }, [q, kind, experiment, offset]);

  const listApi = useApi<DocumentsResponse>(id ? null : listPath);
  const detailApi = useApi<DocumentResponse>(id ? `/api/documents/${encodeURIComponent(id)}` : null);

  const backTo = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (kind) p.set("kind", kind);
    if (experiment) p.set("experiment", experiment);
    const s = p.toString();
    return s ? `/explorer?${s}` : "/explorer";
  }, [q, kind, experiment]);

  const setParam = (key: string, value: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("id");
      return next;
    });
  };

  const openDoc = (docId: number) => {
    const next = new URLSearchParams(params);
    next.set("id", String(docId));
    navigate(`/explorer?${next.toString()}`);
  };

  return (
    <AppShell subtitle={t("Source Documents")}>
      {id ? (
        <Detail api={detailApi} backTo={backTo} />
      ) : (
        <List
          q={q}
          kind={kind}
          experiment={experiment}
          offset={offset}
          setOffset={setOffset}
          onSearch={(v) => setParam("q", v)}
          onKind={(k) => setParam("kind", k)}
          onOpen={openDoc}
          api={listApi}
        />
      )}
    </AppShell>
  );
}
