import { useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/Markdown";
import { Empty, PageHead, Panel, Stat } from "../../components/Page";
import { Toast, useToast } from "../../components/Toast";
import { clamp, fmt, num } from "../../lib/format";
import { useI18n } from "../../lib/i18n/provider";
import { postSse } from "../../lib/sse";

const TOPICS = [
  "Microgravity flame spread and spacecraft fire safety",
  "Smoke and soot in microgravity: measurement and detection",
  "Fire suppression in microgravity habitats",
  "Material flammability screening for spacecraft",
];

interface ReportMetrics {
  questions?: unknown;
  grounded?: unknown;
  citations?: unknown;
  unique_sources?: unknown;
  mean_confidence?: unknown;
  latency_ms?: unknown;
}

interface ReportData {
  topic?: string;
  generated_at?: string;
  generator?: { model?: string; provider?: string };
  summary?: string;
  key_findings?: unknown[];
  evidence?: unknown[];
  references?: unknown[];
  limitations?: string[];
  recommendations?: string[];
  metrics?: ReportMetrics;
}

interface ProgressLine {
  event: string;
  detail: string;
}

/** One-line description of a streaming report event for the live timeline. */
function progressDetail(event: string, data: Record<string, unknown>): string {
  if (event === "report_progress") {
    const done = `${fmt(data.completed)}/${fmt(data.total)}`;
    const q = clamp(data.question, 80);
    return data.failed ? `${done} · failed: ${q}` : `${done} · ${q}`;
  }
  if (event === "report_summary") return `summarising ${fmt(data.questions)} finding(s)`;
  return clamp(JSON.stringify(data), 120);
}

/** POST /api/export and save the returned attachment, mirroring Chat's ExportRow. */
function ExportRow({ markdown, title, onToast }: { markdown: string; title: string; onToast: (m: string) => void }) {
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
        body: JSON.stringify({ markdown, format, title: title || "LAVA report", filename: "lava-report" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `lava-report.${format}`;
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

export default function Reports() {
  const { t } = useI18n();
  const [toastMsg, toast] = useToast();

  const [topic, setTopic] = useState("");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<ProgressLine[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const started = running || attempted;

  async function generate(override?: string) {
    const q = (override ?? topic).trim();
    if (!q || running) return;
    setRunning(true);
    setAttempted(true);
    setError(null);
    setMarkdown("");
    setReport(null);
    setLines([]);

    let finalMd = "";
    let finalReport: ReportData | null = null;
    let failure: string | null = null;
    try {
      await postSse("/api/report", { topic: q, stream: true, k: 8 }, (raw) => {
        const ev = raw as { event?: string; data?: Record<string, unknown> };
        if (!ev.event) return;
        if (ev.event === "error") {
          failure = String(ev.data?.error ?? "agent error");
        } else if (ev.event === "done") {
          const data = ev.data ?? {};
          finalMd = String(data.markdown ?? "");
          finalReport = (data.report as ReportData) ?? null;
        } else if (ev.event !== "close") {
          const data = ev.data ?? {};
          setLines((l) => [...l, { event: ev.event as string, detail: progressDetail(ev.event as string, data) }]);
        }
      });
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }

    setRunning(false);
    if (failure) {
      setError(failure);
      return;
    }
    setMarkdown(finalMd);
    setReport(finalReport);
  }

  const metrics = report?.metrics;
  const hasMetrics =
    !!metrics && [metrics.questions, metrics.grounded, metrics.citations].some((v) => num(v) !== null);

  return (
    <AppShell subtitle={t("Research Briefs")}>
      <PageHead title={t("Research Briefs")} sub={t("a grounded, cited report across the standard question set")} />

      <Panel className="panel reveal" title={t("Topic")} sub={t("pick a suggestion or write your own")}>
        <div style={{ padding: "16px 18px 18px" }}>
          <div className="hstack wrap" style={{ marginBottom: 12 }}>
            {TOPICS.map((tp) => (
              <button
                key={tp}
                className="chip"
                type="button"
                disabled={running}
                onClick={() => {
                  setTopic(tp);
                  void generate(tp);
                }}
              >
                {t(tp)}
              </button>
            ))}
          </div>
          <div className="field" style={{ paddingRight: 6 }}>
            <Icon name="file" size={16} />
            <input
              aria-label={t("Report topic...")} placeholder={t("Report topic...")}
              autoComplete="off"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void generate();
              }}
            />
            <button
              className="btn primary sm nowrap"
              type="button"
              disabled={running || !topic.trim()}
              onClick={() => void generate()}
            >
              {running ? t("Generating...") : t("Generate report")}
            </button>
          </div>
        </div>
      </Panel>

      {running && (
        <div className="strip">
          <span className="spin" />
          <span>
            <span className="muted">{t("building")}</span>{" "}
            {t("building the report, this runs several analysis passes...")}
          </span>
          {lines.length > 0 && (
            <div className="small muted" style={{ flexBasis: "100%", marginTop: 8 }}>
              {lines.map((l, i) => (
                <div key={i}>
                  • <span className="muted">{l.event}</span> {l.detail}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <Panel className="panel reveal">
          <Empty icon="alert">
            {t("Report failed")}: {error}
          </Empty>
        </Panel>
      )}

      {!running && !error && started && (
        <Panel
          className="panel reveal"
          title={t("Report")}
          actions={markdown ? <ExportRow markdown={markdown} title={topic || t("LAVA report")} onToast={toast} /> : undefined}
        >
          {hasMetrics && (
            <div className="stat-row" style={{ padding: "16px 18px 0" }}>
              <Stat label={t("Questions")} value={num(metrics!.questions) ?? 0} sub={t("researched")} />
              <Stat label={t("Grounded")} value={num(metrics!.grounded) ?? 0} sub={t("cited answers")} />
              <Stat label={t("Citations")} value={num(metrics!.citations) ?? 0} sub={t("traced claims")} />
              {num(metrics!.unique_sources) !== null && (
                <Stat label={t("Sources")} value={num(metrics!.unique_sources) ?? 0} sub={t("unique NTRS IDs")} />
              )}
            </div>
          )}
          {markdown ? (
            <div style={{ padding: "16px 18px 18px" }}>
              <Markdown html={markdown} />
              {report?.generated_at && (
                <div className="small muted" style={{ marginTop: 10 }}>
                  {t("Generated")} {report.generated_at}
                  {report.generator?.model ? ` · ${report.generator.model}` : ""}
                </div>
              )}
            </div>
          ) : (
            <Empty>{t("The report came back empty.")}</Empty>
          )}
        </Panel>
      )}

      {!running && !error && !started && (
        <Panel className="panel reveal">
          <Empty icon="file">{t("Enter a topic to generate a grounded research report.")}</Empty>
        </Panel>
      )}

      <Toast message={toastMsg} />
    </AppShell>
  );
}
