/**
 * Cited research-report assembly.
 *
 * A report is a set of self-contained agent runs (one per question), a narrative
 * summary over their findings, and a de-duplicated evidence table. It mirrors
 * pipeline/report.py so the Python and Worker outputs agree.
 */
import type { Env } from "./db";
import { db } from "./db";
import { log } from "./http";
import { llmComplete, parseJsonObject, synthBudgets, DEFAULT_FAST_MODEL } from "./llm";
import { runAgent } from "./agent";

export const REPORT_QUESTIONS = [
  "How does flame spread over solid fuels differ in microgravity?",
  "What limits flame extinction and quenching in microgravity?",
  "What is the limiting oxygen concentration for spacecraft fire safety?",
  "How are smoke and soot produced and detected in microgravity?",
  "Which fire suppression agents and methods work in microgravity?",
  "What did the large-scale spacecraft fire experiments (SAFFIRE) show?",
];

const SUMMARY_SYSTEM =
  "You are LAVA Intelligence, a scientific research analyst specialising in microgravity combustion " +
  "and spacecraft fire safety. Write the executive summary of a research report. " +
  "Use ONLY the provided findings. Do not introduce facts, numbers, or citations that are " +
  "not present. Cite findings with bracketed numbers like [2]. " +
  'Return JSON: {"summary": string (3-5 short paragraphs, markdown), ' +
  '"limitations": [string], "recommendations": [string]}';

export async function buildReport(env: Env, topic: string, questions: string[] | undefined,
                                  k: number, model: string | undefined, maxQuestions: number | undefined,
                                  onProgress?: (event: string, data: any) => void) {
  const t0 = Date.now();
  const sql = db(env);
  let qs = [...(questions?.length ? questions : REPORT_QUESTIONS)];
  if (topic && !qs.includes(topic)) qs.unshift(topic);
  if (maxQuestions) qs = qs.slice(0, maxQuestions);

  const statsRows: any[] = await sql`SELECT * FROM ignis.document_stats`;
  const stats = statsRows[0] ?? {};

  // Each question is researched as a self-contained agent run. They are
  // independent, so run them concurrently; progress is reported as they settle
  // so a streaming caller sees the report grow instead of waiting for all of it.
  let completed = 0;
  const settled = await Promise.all(qs.map(async (q) => {
    try {
      const res = await runAgent(env, q, "fast", model, k, () => {});
      completed++;
      onProgress?.("report_progress", {
        completed, total: qs.length, question: q,
        confidence: res.confidence, grounded: res.grounded,
      });
      return {
        question: q, answer: res.answer, confidence: res.confidence, grounded: res.grounded,
        citations: res.claims, evidence_count: res.evidence.length,
        provider: res.provider, model: res.model, latency_ms: res.latency_ms,
      };
    } catch (err: any) {
      completed++;
      log("report_question_failed", { question: q, message: String(err?.message ?? err).slice(0, 160) });
      onProgress?.("report_progress", {
        completed, total: qs.length, question: q, failed: true,
      });
      return null;
    }
  }));
  const findings: any[] = settled.filter(Boolean);

  onProgress?.("report_summary", { questions: findings.length });

  let narrative: { summary: string; limitations: string[]; recommendations: string[] };
  const llmModel = model || DEFAULT_FAST_MODEL;
  if (findings.length) {
    const blocks = findings.map((f, i) => `[${i + 1}] ${f.question}\n${String(f.answer).slice(0, 1500)}`);
    try {
      const raw = await llmComplete(
        env, SUMMARY_SYSTEM,
        `Report topic: ${topic}\n\nFindings:\n\n${blocks.join("\n\n")}`, llmModel, true,
        synthBudgets(llmModel)[0],
      );
      const data = parseJsonObject(raw);
      narrative = {
        summary: String(data.summary ?? "").trim(),
        limitations: (data.limitations ?? []).map((x: any) => String(x)).filter((s: string) => s.trim()),
        recommendations: (data.recommendations ?? []).map((x: any) => String(x)).filter((s: string) => s.trim()),
      };
      if (!narrative.summary) throw new Error("empty summary");
    } catch (err: any) {
      log("report_summary_fallback", { message: String(err?.message ?? err).slice(0, 160) });
      narrative = fallbackSummary(topic, findings, stats);
    }
  } else {
    narrative = fallbackSummary(topic, findings, stats);
  }

  const evidenceMap = new Map<string, any>();
  for (const f of findings) for (const c of f.citations ?? []) {
    const key = String(c.chunk_id ?? c.source_id ?? "");
    if (key && !evidenceMap.has(key)) {
      evidenceMap.set(key, {
        source_id: c.source_id, title: c.title, section: c.section,
        support_score: c.support_score, quote: c.quote, landing_url: c.landing_url,
      });
    }
  }
  const evidence = [...evidenceMap.values()].sort((a, b) => (b.support_score ?? 0) - (a.support_score ?? 0));
  const sources = [...new Set(evidence.map((e) => e.source_id).filter(Boolean))].sort() as string[];

  return {
    topic,
    generated_at: new Date().toISOString(),
    generator: { provider: "lava-agent", model: llmModel, chain: [llmModel] },
    corpus: {
      documents: stats.documents, chunks: stats.chunks, words: stats.corpus_words,
      experiments: stats.experiments, findings_indexed: stats.findings,
    },
    summary: narrative.summary,
    key_findings: findings,
    evidence,
    comparative: [],
    limitations: narrative.limitations,
    recommendations: narrative.recommendations,
    references: sources.map((s) => ({ source_id: s, landing_url: `https://ntrs.nasa.gov/citations/${s}` })),
    metrics: {
      questions: findings.length,
      grounded: findings.filter((f) => f.grounded).length,
      citations: findings.reduce((n, f) => n + (f.citations?.length ?? 0), 0),
      unique_sources: sources.length,
      mean_confidence: findings.length
        ? Math.round((findings.reduce((s, f) => s + f.confidence, 0) / findings.length) * 1000) / 1000
        : 0,
      latency_ms: Date.now() - t0,
    },
  };
}

function fallbackSummary(topic: string, findings: any[], stats: any) {
  const grounded = findings.filter((f) => f.grounded);
  const lines = [
    `This report covers **${topic}** across ${stats.documents ?? 0} NASA documents and ` +
    `${stats.chunks ?? 0} indexed passages (${Number(stats.corpus_words ?? 0).toLocaleString()} words).`,
    `${grounded.length} of ${findings.length} research questions returned grounded, cited answers.`,
  ];
  findings.forEach((f, i) => {
    if (f.grounded) {
      const lead = String(f.answer).split("\n\n").find((p: string) => p.length > 80) ?? String(f.answer);
      lines.push(`[${i + 1}] **${f.question}** - ${lead.slice(0, 400)}`);
    }
  });
  return {
    summary: lines.join("\n\n"),
    limitations: [
      "Answers are assembled from retrieved passages; coverage depends on what the corpus contains.",
      "Quantitative values are quoted from the source documents and were not independently re-measured.",
    ],
    recommendations: [] as string[],
  };
}

/** Render a report object to markdown (mirrors pipeline/report.py render_markdown). */
export function renderMarkdown(r: any): string {
  const out: string[] = [
    `# LAVA Research Report - ${r.topic}`, "",
    `*Generated ${r.generated_at} by ${r.generator.provider}/${r.generator.model}*`, "",
    "## Executive Summary", "", r.summary, "",
    "## Corpus", "",
    `- Documents: ${r.corpus.documents}`,
    `- Indexed passages: ${r.corpus.chunks}`,
    `- Words: ${Number(r.corpus.words ?? 0).toLocaleString()}`, "",
    "## Key Findings", "",
  ];
  r.key_findings.forEach((f: any, i: number) => {
    out.push(`### ${i + 1}. ${f.question}`, "");
    out.push(`*Confidence ${f.confidence} · ${f.citations.length} citations · ${f.grounded ? "grounded" : "ungrounded"}*`, "");
    out.push(f.answer, "");
  });
  out.push("## Data Limitations", "");
  r.limitations.forEach((l: string) => out.push(`- ${l}`));
  out.push("");
  if (r.recommendations.length) {
    out.push("## Recommendations", "");
    r.recommendations.forEach((x: string) => out.push(`- ${x}`));
    out.push("");
  }
  out.push("## Evidence Table", "", "| # | NTRS ID | Section | Score | Quote |", "|---|---------|---------|-------|-------|");
  r.evidence.forEach((e: any, i: number) => {
    const quote = String(e.quote ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 180);
    out.push(`| ${i + 1} | ${e.source_id} | ${e.section ?? ""} | ${e.support_score} | ${quote} |`);
  });
  out.push("", "## References", "");
  r.references.forEach((x: any) => out.push(`- [${x.source_id}](${x.landing_url})`));
  out.push("", "---", "",
    `*${r.metrics.grounded}/${r.metrics.questions} questions grounded · ${r.metrics.citations} citations · ` +
    `${r.metrics.unique_sources} unique sources · generated in ${r.metrics.latency_ms} ms*`, "");
  return out.join("\n");
}
