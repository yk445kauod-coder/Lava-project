import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useSearchParams } from "react-router-dom";

import { Icon } from "../../components/Icon";
import { BrandLogo } from "../../components/BrandLogo";
import { LangMenu } from "../../components/LangMenu";
import { Markdown } from "../../components/Markdown";
import { ThemeToggle } from "../../components/ThemeToggle";
import { Toast, useToast } from "../../components/Toast";
import type { AskResult, StageStep } from "../../lib/agentTypes";
import { STAGE_LABEL, STOP_LABEL, isPartial, stageDetail } from "../../lib/agentStages";
import {
  conversationId,
  groupConversations,
  loadConversations,
  saveConversations,
  type Conversation,
} from "../../lib/chatStore";
import { clamp, fmt } from "../../lib/format";
import { useCorpusStats } from "../../lib/hooks";
import { useI18n } from "../../lib/i18n/provider";
import { useTranslated } from "../../lib/i18n/data";
import { NAV } from "../../lib/nav";
import { postSse } from "../../lib/sse";
import { useSheetDrag } from "../../lib/useSheetDrag";

const PROMPTS = [
  "How does flame spread over solid fuels differ in microgravity compared with Earth?",
  "Explain how flames behave in microgravity",
  "Compare the flame spread experiments in the corpus",
  "What does the corpus say about limiting oxygen concentration for spacecraft fire safety?",
];

const PROMPT_CARDS: [string, string][] = [
  ["chart", "Analyze experimental data"],
  ["sparkles", "Explain scientific concepts"],
  ["compare", "Compare experiments"],
  ["shield", "Generate research insights"],
];

const MODELS: { group: string; items: { value: string; label: string }[] }[] = [
  {
    group: "SI flagship",
    items: [
      { value: "si-1", label: "SI 1 (balanced)" },
      { value: "si-max", label: "SI MAX (deeper reasoning)" },
      { value: "si-ultra", label: "SI ULTRA (deepest reasoning)" },
    ],
  },
  {
    group: "SI free",
    items: [
      { value: "si-nova", label: "SI NOVA (fast all-rounder)" },
      { value: "si-nova-lite", label: "SI NOVA LITE (light & quick)" },
      { value: "si-pulse", label: "SI PULSE (very fast)" },
      { value: "si-pulse-lite", label: "SI PULSE LITE (fastest)" },
      { value: "si-ember", label: "SI EMBER (edge-hosted)" },
    ],
  },
];

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const hasArabic = (s: unknown) => ARABIC_RE.test(String(s ?? ""));
/** `lang="ar"` on a node whose text is Arabic drives the RTL/font CSS. */
const dirProps = (s: unknown) => (hasArabic(s) ? { lang: "ar" as const } : {});

/* ------------------------------- messages ------------------------------- */

function UserBubble({ text }: { text: string }) {
  return (
    <div className="msg user enter">
      <div className="body" {...dirProps(text)}>
        {text}
      </div>
    </div>
  );
}

function Evidence({ result }: { result: AskResult }) {
  const { t } = useI18n();
  const claims = result.claims || [];
  const evidence = result.evidence || [];
  if (!claims.length && !evidence.length) return null;
  return (
    <div className="evidence">
      {claims.length > 0 && <h3 className="ev-h">{t("Claims (each traced to a passage)")}</h3>}
      {claims.map((c, i) => (
        <div className="hit" key={`c${i}`}>
          <div className="hittitle">
            <sup className="cite">[{i + 1}]</sup> {c.title || t("Source")}
            {c.verified === false && <span className="muted small">{t("unverified")}</span>}
          </div>
          <div className="meta">
            NTRS {c.source_id || ""}
            {c.section ? ` · ${c.section}` : ""}
            {c.support_score != null ? ` · support ${Number(c.support_score).toFixed(3)}` : ""}
          </div>
          {c.quote && (
            <blockquote className="quote" {...dirProps(c.quote)}>
              {c.quote}
            </blockquote>
          )}
          {c.landing_url && (
            <a href={c.landing_url} target="_blank" rel="noreferrer">
              {t("Open source document")} ↗
            </a>
          )}
        </div>
      ))}
      {evidence.length > 0 && <h3 className="ev-h">{t("Ranked passages (hybrid RRF + smart ranking)")}</h3>}
      {evidence.map((h, i) => {
        const score = Number(h.final_score || 0);
        return (
          <div className="hit" key={`e${i}`}>
            <div className="hittitle">
              <sup className="cite">[{i + 1}]</sup> {h.title || ""}
            </div>
            <div className="meta">
              NTRS {h.source_id}
              {h.kind ? ` · ${h.kind}` : ""}
              {h.section_path ? ` · ${h.section_path}` : ""}
            </div>
            {h.why ? <div className="meta">{h.why}</div> : null}
            <div className="body" {...dirProps(h.content)}>
              {String(h.content || "").slice(0, 420)}...
            </div>
            <div className="bar">
              <i style={{ width: `${Math.max(4, Math.min(100, score * 100))}%` }} />
            </div>
            <div className="meta">
              fused {score.toFixed(3)} · vector {Number(h.vector_score || 0).toFixed(3)} · keyword{" "}
              {Number(h.keyword_score || 0).toFixed(3)} · rerank {Number(h.rerank_score || 0).toFixed(3)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExportRow({ result, onToast }: { result: AskResult; onToast: (m: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const formats: [string, string][] = [
    ["pdf", "PDF"],
    ["docx", "DOCX"],
    ["md", "Markdown"],
  ];
  async function exportAs(format: string) {
    setBusy(format);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: result.answer,
          format,
          title: "LAVA Intelligence answer",
          filename: `lava-${String(result.run_id || "").slice(0, 8) || "answer"}`,
          charts: result.chart ? [result.chart.spec] : [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `lava-${String(result.run_id || "").slice(0, 8) || "answer"}.${format}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      onToast(t("Download started"));
    } catch (e) {
      onToast(`${t("Export failed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="exportrow">
      {formats.map(([f, label]) => (
        <button key={f} type="button" disabled={busy !== null} onClick={() => exportAs(f)}>
          <Icon name="download" size={14} /> {label}
        </button>
      ))}
    </div>
  );
}

function AiMessage({ result, onToast }: { result: AskResult; onToast: (m: string) => void }) {
  const { t } = useI18n();
  const grounded = !!result.grounded;
  const partial = isPartial(result.stop_reason);
  const claims = result.claims || [];
  const evidence = result.evidence || [];
  return (
    <div className="msg ai enter">
      <span className="av">
        <Icon name="bolt" size={16} />
      </span>
      <div className="body">
        <p className="answer-meta">
          <span className={`dot${grounded ? "" : " warn"}`} />
          {grounded ? t("grounded in sources") : t("low grounding")}
          {partial && <> · {t("partial")} · {t(STOP_LABEL[result.stop_reason ?? ""] || result.stop_reason || "")}</>}
          {" · "}
          <span title={t("Share of the answer's sentences that carry a source citation, not a confidence in correctness.")}>
            {t("citation coverage")} {Math.round((Number(result.confidence) || 0) * 100)}%
          </span>
          {" · "}{claims.length} {t("cited claims")}
          {" · "}{evidence.length} {t("passages")}
          {" · "}{((Number(result.latency_ms) || 0) / 1000).toFixed(1)}s
        </p>
        <p className="ai-badge" title={t("AI-generated draft, check the cited sources")}>
          <Icon name="sparkles" size={12} />
          {t("Generated by a language model")}
        </p>
        <div className="answer" {...dirProps(result.answer)}>
          <Markdown html={String(result.answer || "")} className="md" />
        </div>
        {result.chart?.svg && (
          <figure className="chartbox">
            <div dangerouslySetInnerHTML={{ __html: result.chart.svg }} />
            {result.chart.note && <figcaption>{result.chart.note}</figcaption>}
          </figure>
        )}
        <ExportRow result={result} onToast={onToast} />
        {(result.sub_questions || []).length > 0 && (
          <details className="agent-details">
            <summary>Sub-questions ({result.sub_questions!.length})</summary>
            <ol>
              {result.sub_questions!.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </details>
        )}
        <Evidence result={result} />
      </div>
    </div>
  );
}

function WorkingBubble({ steps }: { steps: StageStep[] }) {
  const { t } = useI18n();
  const [secs, setSecs] = useState(0);
  const startedAt = useRef(Date.now());
  const lastStage = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setSecs((Date.now() - startedAt.current) / 1000), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    lastStage.current = Date.now();
  }, [steps.length]);
  const idle = (Date.now() - lastStage.current) / 1000 > 18;
  return (
    <div className="msg ai enter">
      <span className="av">
        <Icon name="bolt" size={16} />
      </span>
      <div className="body">
        <div className="working-row">
          <span className="spinner" />
          <span>{t("Working")}</span>
          <span className="secs">{secs.toFixed(1)}s</span>
        </div>
        {idle && (
          <p className="working-hint">
            {t("Synthesizing the answer from the retrieved passages. This step runs one long model call.")}
          </p>
        )}
        <ol className="stage-timeline">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="muted">{STAGE_LABEL[s.node] || s.node}</span>
              <span>{stageDetail(s.node, s.data, t)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ------------------------------- sidebar -------------------------------- */

function ChatSidebar({
  convs,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onClose,
}: {
  convs: Conversation[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupConversations(convs, query), [convs, query]);
  return (
    <aside className="sidebar" id="sidebar">
      <div className="brand">
        <BrandLogo />
        <small>{t("LAVA Intelligence")}</small>
        <button className="icon-btn only-mobile" type="button" aria-label={t("Close menu")} onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <button className="btn primary block" type="button" onClick={onNew}>
        <Icon name="plus" size={16} /> <span>{t("New chat")}</span>
      </button>
      <label className="search">
        <Icon name="search" size={15} />
        <input
          placeholder={t("Search conversations")}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="sb-scroll">
        <nav className="wsnav">
          {NAV.flatMap((g) => g.items).map((it) => (
            <NavLink key={it.id} to={it.href} end>
              <Icon name={it.icon} size={16} />
              <span>{t(it.label)}</span>
            </NavLink>
          ))}
        </nav>
        <nav className="history" aria-label={t("Recent conversations")}>
          {groups.length === 0 && (
            <p className="empty-h">
              {query ? t("No conversations match your search.") : t("No conversations yet. Start a new chat to begin.")}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="group-label">{t(g.label)}</div>
              {g.items.map((c) => (
                <div key={c.id} className={`conv${c.id === activeId ? " active" : ""}`}>
                  <button className="t" type="button" onClick={() => onSelect(c.id)}>
                    {c.title}
                  </button>
                  <button
                    className="more"
                    type="button"
                    aria-label={t("Delete conversation")}
                    onClick={() => onDelete(c.id)}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="profile">
        <span className="avatar">LA</span>
        <div>
          <b>{t("LAVA Lab")}</b>
        </div>
      </div>
    </aside>
  );
}

/* ----------------------------- research panel --------------------------- */

function ResearchPanel({ onAsk, onDismiss }: { onAsk: (q: string) => void; onDismiss: () => void }) {
  const { t } = useI18n();
  const stats = useCorpusStats();
  const { dragStyle, handlers } = useSheetDrag(onDismiss);
  const [insights, setInsights] = useState<{ slug: string; title: string }[]>([]);
  useEffect(() => {
    fetch("/api/insights")
      .then((r) => (r.ok ? r.json() : { insights: [] }))
      .then((d) => setInsights((d.insights || []).slice(0, 4)))
      .catch(() => undefined);
  }, []);
  const insightTitles = useTranslated(insights.map((i) => i.title));
  const suggested: [string, string, string][] = [
    [t("Flame spread"), t("microgravity vs. Earth"), PROMPTS[0]],
    [t("Oxygen limits"), t("spacecraft fire safety"), PROMPTS[3]],
    [
      t("Smoke & soot"),
      t("fire detection"),
      "How do smoke and soot behave in microgravity, and what does it mean for fire detection?",
    ],
  ];
  return (
    <aside
      className="panel"
      id="panel"
      aria-label={t("Research Context")}
      style={dragStyle}
    >
      <div className="sheet-handle" aria-hidden="true" {...handlers}>
        <span />
      </div>
      <div className="panel-head">
        <h2>
          <b>{t("Research Context")}</b>
        </h2>
        <button className="icon-btn only-mobile" type="button" aria-label={t("Close")} onClick={onDismiss}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="block-c">
        <h2>{t("Corpus")}</h2>
        <div className="kv">
          <b>{fmt(stats?.documents)}</b>
          <span className="muted">{t("documents")}</span>
        </div>
        <small className="muted">
          {fmt(stats?.corpus_words)} {t("words")} · {fmt(stats?.chunks)} {t("passages")}
        </small>
      </div>
      <div className="block-c">
        <h2>{t("Indexed passages")}</h2>
        <div className="file">
          <Icon name="database" size={20} />
          <div>
            <b>{fmt(stats?.chunks)}</b>
            <small>{fmt(stats?.embeddings)} {t("also vector-searchable")}</small>
          </div>
        </div>
      </div>
      <div className="block-c">
        <h2>{t("Experiments")}</h2>
        <span className="muted">{fmt(stats?.experiments)} {t("experiments")} · {t("Microgravity")}</span>
      </div>
      <div className="block-c">
        <h2>{t("Recent findings")}</h2>
        {insights.length === 0 && <small className="muted">{t("No findings available.")}</small>}
        {insights.map((ins, i) => (
          <button key={ins.slug} className="rel" type="button" onClick={() => onAsk(`${t("Explain this finding:")} ${insightTitles[i] || ins.title}`)}>
            <b>{clamp(insightTitles[i] || ins.title, 70)}</b>
          </button>
        ))}
      </div>
      <div className="block-c">
        <h2>{t("Suggested questions")}</h2>
        {suggested.map(([b, s, q]) => (
          <button key={b} className="rel" type="button" onClick={() => onAsk(q)}>
            <b>{b}</b>
            <small>{s}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

/* --------------------------------- page --------------------------------- */

/** Mobile-only bottom sheet holding the secondary actions that the topbar
 *  hides on small screens (language, theme, new conversation). */
function MoreSheet({ open, onClose, onNew }: { open: boolean; onClose: () => void; onNew: () => void }) {
  const { t } = useI18n();
  const { dragStyle, handlers } = useSheetDrag(onClose);
  return (
    <div className={`m-sheet m-more${open ? " open" : ""}`} id="moreSheet" aria-hidden={!open}>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={dragStyle}>
        <div className="sheet-handle" aria-hidden="true" {...handlers}>
          <span />
        </div>
        <Link className="m-more-row" to="/dashboard" onClick={onClose}>
          <Icon name="grid" size={18} /> {t("Home")}
        </Link>
        <button className="m-more-row" type="button" onClick={onNew}>
          <Icon name="plus" size={18} /> {t("New conversation")}
        </button>
        <div className="m-more-row">
          <Icon name="globe" size={18} /> <span>{t("Language")}</span>
          <span className="m-more-ctl">
            <LangMenu />
          </span>
        </div>
        <div className="m-more-row">
          <Icon name="sun" size={18} /> <span>{t("Theme")}</span>
          <span className="m-more-ctl">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [toastMsg, toast] = useToast();

  const [convs, setConvs] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<StageStep[]>([]);
  const [mode, setMode] = useState<"fast" | "deep">("fast");
  const [model, setModel] = useState("");
  // On phones the research panel is a sheet, so start it closed; on wider
  // screens it is a docked column and starts open.
  const [panelOff, setPanelOff] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches,
  );
  const [navOpen, setNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const active = useMemo(() => convs.find((c) => c.id === activeId) || null, [convs, activeId]);
  const hasMessages = !!active && active.messages.length > 0;
  const panelOpen = !panelOff;

  const persist = useCallback((next: Conversation[]) => {
    setConvs(next);
    saveConversations(next);
  }, []);

  const bottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question) return;
      let conv = convs.find((c) => c.id === activeId);
      let next = convs;
      if (!conv) {
        conv = {
          id: `c${Date.now()}`,
          title: question.length > 38 ? `${question.slice(0, 38)}...` : question,
          ts: Date.now(),
          messages: [],
        };
        next = [...convs, conv];
        setActiveId(conv.id);
      }
      const convId = conv.id;
      next = next.map((c) =>
        c.id === convId ? { ...c, ts: Date.now(), messages: [...c.messages, { role: "user" as const, text: question }] } : c,
      );
      persist(next);
      setDraft("");
      setBusy(true);
      setSteps([]);
      bottom();

      let result: AskResult | null = null;
      let failed: string | null = null;
      try {
        await postSse(
          "/api/ask",
          { question, k: 8, stream: true, mode, model: model || undefined, conversation_id: conversationId() },
          (raw) => {
            const ev = raw as { event?: string; data?: Record<string, unknown> };
            if (ev.event === "error") failed = String(ev.data?.error ?? "agent error");
            else if (ev.event === "done") result = ev.data as AskResult;
            else if (ev.event && STAGE_LABEL[ev.event]) {
              const node = ev.event;
              const data = ev.data ?? {};
              setSteps((s) => [...s, { node, data }]);
            }
          },
        );
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e);
      }

      setBusy(false);
      if (failed) {
        toast(`${t("LAVA Intelligence error")}: ${failed}`);
        return;
      }
      if (result) {
        const ai = result as AskResult;
        setConvs((prev) => {
          const upd = prev.map((c) =>
            c.id === convId ? { ...c, ts: Date.now(), messages: [...c.messages, { role: "ai" as const, result: ai }] } : c,
          );
          saveConversations(upd);
          return upd;
        });
      }
      bottom();
    },
    [activeId, bottom, convs, mode, model, persist, toast],
  );

  // A `?q=` param (from the dashboard / global search) starts a run once.
  useEffect(() => {
    const q = params.get("q");
    if (q) ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newChat() {
    setActiveId(null);
    setDraft("");
    setNavOpen(false);
    setMoreOpen(false);
    textRef.current?.focus();
  }

  function deleteConv(id: string) {
    persist(convs.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  return (
    <div className="console-chat">
      <div
        className={`app${navOpen ? " nav-open" : ""}${panelOpen ? " panel-open" : " panel-off"}`}
        id="app"
      >
        <div className="scrim" onClick={() => setNavOpen(false)} />
        <ChatSidebar
          convs={convs}
          activeId={activeId}
          onNew={newChat}
          onSelect={(id) => {
            setActiveId(id);
            setNavOpen(false);
          }}
          onDelete={deleteConv}
          onClose={() => setNavOpen(false)}
        />

        <main className="main">
          <header className="topbar">
            <button className="icon-btn only-mobile" type="button" aria-label={t("Open menu")} onClick={() => setNavOpen(true)}>
              <Icon name="menu" size={20} />
            </button>
            <div className="title">
              <h1 className="tb-h1">{t("LAVA Intelligence Console")}</h1>
            </div>
            <div className="actions">
              <span className="topbar-extra hide-sm">
                <LangMenu />
                <ThemeToggle />
              </span>
              <button className="btn ghost hide-sm" type="button" onClick={newChat}>
                <Icon name="plus" size={15} /> {t("New conversation")}
              </button>
              <button
                className="icon-btn hide-sm"
                type="button"
                aria-label={t("Toggle research context")}
                aria-expanded={panelOpen}
                onClick={() => setPanelOff((v) => !v)}
              >
                <Icon name="layers" size={18} />
              </button>
            </div>
          </header>

          <section className="scroll" ref={scrollRef}>
            {!hasMessages && (
              <div className="welcome">
                <h2 className="hero-h">{t("LAVA Intelligence")}</h2>
                <p className="lead">
                  {t("A research assistant for microgravity combustion. It plans, retrieves, grades evidence and cites every claim.")}
                </p>
                <p className="sub">
                  {t("Ask grounded questions over the NASA NTRS corpus. Every answer is generated from retrieved passages and cites the sources it used.")}
                </p>
                <div className="cards">
                  {PROMPTS.map((p, i) => (
                    <button key={p} className="card" type="button" onClick={() => ask(p)}>
                      <Icon name={PROMPT_CARDS[i][0]} size={20} />
                      <b>{t(PROMPT_CARDS[i][1])}</b>
                      <span>{clamp(t(p), 90)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {hasMessages && (
              <div className="messages" id="messages">
                {active!.messages.map((m, i) =>
                  m.role === "user" ? (
                    <UserBubble key={i} text={m.text} />
                  ) : (
                    <AiMessage key={i} result={m.result} onToast={toast} />
                  ),
                )}
                {busy && <WorkingBubble steps={steps} />}
              </div>
            )}
          </section>

          <footer className="composer-wrap">
            <div className="agent-bar">
              <div className="seg" role="group" aria-label={t("Reasoning mode")}>
                <button type="button" className={mode === "fast" ? "seg-on" : ""} onClick={() => setMode("fast")}>
                  {t("Fast")}
                </button>
                <button type="button" className={mode === "deep" ? "seg-on" : ""} onClick={() => setMode("deep")}>
                  {t("Deep")}
                </button>
              </div>
              <select className="select" aria-label={t("Model")} value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">{t("Default model")}</option>
                {MODELS.map((g) => (
                  <optgroup key={g.group} label={t(g.group)}>
                    {g.items.map((it) => (
                      <option key={it.value} value={it.value}>
                        {t(it.label)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="muted">
                {model ? t(MODELS.flatMap((g) => g.items).find((x) => x.value === model)?.label || "") : t("Grounded answers with citations")}
              </span>
            </div>
            <div className="composer">
              <textarea
                ref={textRef}
                rows={1}
                placeholder={t("Ask LAVA Intelligence about your research...")}
                aria-label={t("Message")}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    ask(draft);
                  }
                }}
              />
              {draft && (
                <button className="icon-btn" type="button" aria-label={t("Clear input")} onClick={() => setDraft("")}>
                  <Icon name="close" size={16} />
                </button>
              )}
              <button className="send" type="button" aria-label={t("Send message")} disabled={!draft.trim() || busy} onClick={() => ask(draft)}>
                <Icon name="arrowRight" size={18} />
              </button>
            </div>
            <small className="hint">{t("Enter to send · Shift + Enter for a new line · Answers cite the source passages")}</small>
          </footer>
        </main>

        <ResearchPanel onAsk={ask} onDismiss={() => setPanelOff(true)} />

        <nav className="m-botnav" aria-label={t("Primary")}>
          <button className="m-nav-btn" type="button" onClick={() => setNavOpen(true)}>
            <Icon name="menu" size={19} />
            <span>{t("Chats")}</span>
          </button>
          <button className="m-nav-btn" type="button" onClick={newChat}>
            <Icon name="plus" size={19} />
            <span>{t("New")}</span>
          </button>
          <button
            className={`m-nav-btn${panelOpen ? " on" : ""}`}
            type="button"
            aria-expanded={panelOpen}
            onClick={() => setPanelOff((v) => !v)}
          >
            <Icon name="layers" size={19} />
            <span>{t("Context")}</span>
          </button>
          <button className="m-nav-btn" type="button" onClick={() => setMoreOpen(true)}>
            <Icon name="more" size={19} />
            <span>{t("More")}</span>
          </button>
        </nav>
      </div>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} onNew={newChat} />
      <Toast message={toastMsg} />
    </div>
  );
}
