/**
 * The LAVA answer engines.
 *
 * Two runners share the same corpus tools:
 *   runAgent   - fixed plan → retrieve → grade → expand → synthesize → verify.
 *   runAgentic - a ReAct loop where the model chooses its own retrieval steps.
 *
 * Both end the same way: claims are derived from the `[n]` markers the model
 * wrote, verified against the passage each marker points at, and only then
 * persisted to memory.
 */
import type { Env } from "./db";
import { db } from "./db";
import { CONF_SQL_FINDING } from "./confidence";
import { log } from "./http";
import { llmChat, llmComplete, parseJsonObject, synthBudgets, toEnglishQuery, toAnswerLanguage, detectScript, DEFAULT_FAST_MODEL, type ChatMessage } from "./llm";
import { runAgentLoop } from "./agentic";
import { renderSvg } from "./viz";
import type { ChartSpec } from "./export";
import {
  attributeClaims, normalizeCitationMarkers, expandQuery, heuristicGrade, mmrDiversify, retrieveGraded,
  rerank, siRerank, smartRank, synthesizeExtractive, verifyClaims, type Hit,
} from "./retrieval";
import { memoryRecall, memoryWrite, persistSession } from "./memory";

const PLAN_SYSTEM =
  "You decompose research questions about microgravity combustion and spacecraft fire " +
  "safety into 2-4 focused retrieval sub-questions. Return JSON: " +
  '{"sub_questions": ["..."], "key_terms": ["..."]}. ' +
  "Sub-questions must be independently searchable scientific queries. Do not answer the question.";

const SYNTH_SYSTEM = `You are LAVA Intelligence, a scientific research analyst specialising in microgravity combustion and spacecraft fire safety. Answer the question from the numbered evidence blocks. Cite every sentence that comes from a passage with bracketed evidence numbers like [2] - at least two citations, each pointing at a different block where possible. Extract concrete quantitative results when present (spread rates, oxygen or pressure limits, temperatures, experiment names) and cite them. The user may phrase the question with an analogy, a colloquial term, or a hypothesis whose exact words never appear in the corpus - for example "why do flames in microgravity look like plasma?". Do not refuse such a question and do not say the evidence is insufficient merely because the words are missing: answer what the evidence does show, reason from the relevant physics and quantities to address the user's framing, keep every measured fact cited with [n], and mark your own inference as such ("by inference", "the evidence implies"). Stay strictly inside the evidence: never introduce a fact, name, number or claim that is not in the blocks or directly derivable from them, and never answer from your own general knowledge. If the blocks are genuinely unrelated to the question, say the corpus does not cover it and say what would settle it. Never invent values, experiment names, or citations. Structure the answer as markdown so it is scannable rather than one block of prose: start with a one- or two-sentence direct answer, then use short ## headings to group the findings (for example ## Microgravity vs. Earth, ## Quantified results, ## Fire-safety implications). Under each heading use bullet points, one finding per bullet, keeping each bullet to one or two sentences. Use a markdown table when comparing the same quantity across experiments or gravity levels. Bold the key quantity or conclusion in each bullet. Reply with markdown only: no preamble, no JSON, no code fences.`;

/** Total wall-clock allowed for all synthesis attempts on one question. */
const SYNTH_DEADLINE_MS = 90000;

function scheduleHeuristic(question: string): string[] {
  const low = question.toLowerCase();
  const facets: [string, string][] = [
    ["flame spread", "flame spread over solid fuels in microgravity"],
    ["extinguish", "flame extinction and extinguishment in microgravity"],
    ["extinction", "extinction limit and flame extinguishment"],
    ["ignition", "ignition limits of solid fuels"],
    ["smoke", "smoke and soot detection in spacecraft"],
    ["oxygen", "limiting oxygen concentration and atmosphere"],
    ["pressure", "pressure effects on combustion"],
  ];
  const subs: string[] = [];
  for (const [needle, probe] of facets) {
    if (low.includes(needle) && subs.length < 4) subs.push(probe);
  }
  if (subs.length < 2) subs.push(`${question} experimental results`);
  if (subs.length < 3) subs.push("spacecraft fire safety implications microgravity");
  return subs.slice(0, 4);
}

async function plan(env: Env, question: string, model: string,
                    memoryContext = ""): Promise<{ subs: string[]; terms: string[] }> {
  try {
    const memoryBlock = memoryContext ? `\n\nRelevant memory from earlier sessions:\n${memoryContext}\n` : "";
    const planBudget = synthBudgets(model)[0];
    const raw = await llmComplete(env, PLAN_SYSTEM, `Question: ${question}${memoryBlock}\n\n`, model, true, planBudget);
    const data = parseJsonObject(raw);
    const subs = (data.sub_questions ?? []).filter((s: any) => typeof s === "string" && s.length > 4).slice(0, 4);
    const terms = (data.key_terms ?? []).filter((t: any) => typeof t === "string").slice(0, 12);
    if (subs.length) return { subs, terms };
    return { subs: scheduleHeuristic(question), terms: [] };
  } catch {
    return { subs: scheduleHeuristic(question), terms: [] };
  }
}

async function synthesizeWithLLM(env: Env, question: string, hits: Hit[],
                                 subQuestions: string[], model: string): Promise<{ answer: string; claims: any[]; confidence: number }> {
  const evidenceBlocks = hits.slice(0, 5).map((h, i) => {
    const provider = h.source_type === "psi" ? "PSI" : "NTRS";
    return `[${i + 1}] ${h.title} (${provider} ${h.source_id}; section: ${h.section_path ?? h.kind})\n${h.content.slice(0, 900).trim()}`;
  });
  const evidence = evidenceBlocks.join("\n\n");
  let user = `Question: ${question}\n\nEvidence:\n${evidence}`;
  if (subQuestions.length) user += `\n\nSub-questions to address: ${subQuestions.join("; ")}`;

  const deadline = Date.now() + SYNTH_DEADLINE_MS;
  let lastErr: any = null;
  for (const budget of synthBudgets(model)) {
    const remaining = deadline - Date.now();
    if (remaining < 15000) break;
    try {
      const raw = await llmComplete(env, SYNTH_SYSTEM, user, model, false, budget, "low",
                                    Math.min(75000, remaining));
      const answer = raw.trim();
      if (!answer) throw new Error("empty answer");
      const { claims, answer: withMarkers } = attributeClaims(answer, hits);
      const attributed = claims.some((c) => c.attributed);
      const base = claims.length ? Math.min(0.95, 0.62 + 0.08 * claims.length) : 0.2;
      return { answer: withMarkers, claims, confidence: attributed ? base * 0.85 : base };
    } catch (err: any) {
      lastErr = err;
      log("synth_attempt_failed", { budget, message: String(err?.message ?? err).slice(0, 200) });
    }
  }
  log("synth_fallback", { message: String(lastErr?.message ?? lastErr).slice(0, 300) });
  return synthesizeExtractive(question, hits);
}

/** Dataset key -> the words that indicate a question is about it. */
const DATASET_INTENT: Record<string, string[]> = {
  flame_temperature: ["temperature", "thermal", "kelvin", "حرارة", "درجة الحرارة"],
  flame_spread_rate: ["spread", "propagat", "انتشار", "معدل الانتشار"],
  limiting_oxygen_index: ["oxygen", "lox", "oxidizer", "أكسجين", "الاكسجين"],
  pressure: ["pressure", "kpa", "ضغط"],
  soot_volume_fraction: ["soot", "sooting", "سoot", "سخام", "هباب"],
  smoke_particle_size: ["smoke", "particle", "aerosol", "دخان", "جزيئات"],
  gravity_level: ["gravity", "microgravity", "g-level", "جاذبية"],
};

/** Pick the dataset a question is most likely asking to see. */
function pickDataset(question: string, evidenceText = ""): string | null {
  const hay = `${question} ${evidenceText}`.toLowerCase();
  let best: { key: string; score: number } | null = null;
  for (const [key, words] of Object.entries(DATASET_INTENT)) {
    let score = 0;
    for (const w of words) {
      const hits = hay.split(w.toLowerCase()).length - 1;
      if (hits) score += hits * (question.toLowerCase().includes(w.toLowerCase()) ? 3 : 1);
    }
    if (score && (!best || score > best.score)) best = { key, score };
  }
  return best?.key ?? null;
}

/** True when the question is asking for a visual rather than prose. */
function wantsVisual(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(chart|graph|plot|visuali[sz]|diagram|figure|compare.*numerically|distribution)\b/.test(q)
    || /(رسم|مخطط|بياني|رسم بياني|توضيح|مقارنة)/.test(question);
}

export type ChartRequest = {
  dataset: string;
  type?: "bar" | "line" | "scatter";
  limit?: number;
  group_by?: "experiment";
  title?: string;
};

/** Build a chart spec and its data straight from `ignis.dataset_row`. */
export async function buildChart(env: Env, req: ChartRequest): Promise<{ spec: ChartSpec; rows: any[]; meta: any } | { error: string }> {
  const sql = db(env);
  const limit = Math.min(Math.max(Number(req.limit ?? 20), 2), 60);
  let meta: any[] = await sql`SELECT * FROM ignis.dataset WHERE key = ${req.dataset} LIMIT 1`;
  if (!meta.length) meta = await sql`SELECT * FROM ignis.dataset WHERE name ILIKE ${req.dataset} LIMIT 1`;
  if (!meta.length) return { error: `dataset ${req.dataset} not found` };
  const datasetKey = meta[0].key;
  const unit = meta[0].canonical_unit ?? "";

  let rows: any[];
  if (req.group_by === "experiment") {
    rows = await sql`
      SELECT coalesce(experiment_code, 'unlinked') AS label,
             count(*)::int AS n,
             round(avg(value)::numeric, 4) AS value
        FROM ignis.dataset_row
       WHERE dataset_key = ${datasetKey}
       GROUP BY 1 ORDER BY value DESC LIMIT ${limit}`;
  } else {
    rows = await sql`
      SELECT coalesce(experiment_code, document_source_id, 'recorded') AS label, value
        FROM ignis.dataset_row
       WHERE dataset_key = ${datasetKey}
       ORDER BY value LIMIT ${limit}`;
  }
  if (!rows.length) return { error: `dataset ${req.dataset} has no rows` };

  const type = (req.type ?? "bar") as ChartSpec["type"];
  const spec: ChartSpec = {
    type,
    title: req.title ?? `${meta[0].name}${req.group_by === "experiment" ? " by experiment" : ""}`,
    x_label: req.group_by === "experiment" ? "experiment" : "measurement (ordered by value)",
    y_label: meta[0].name,
    unit,
    series: [{
      label: meta[0].name,
      points: rows.map((r, i) => ({ x: type === "bar" ? String(r.label) : i + 1, y: Number(r.value) })),
    }],
    source_note: `${rows.length} recorded values from NASA NTRS reports · extracted by regex · unit ${unit || "n/a"}`,
  };
  return { spec, rows, meta: meta[0] };
}

/** Plottable metrics with their value counts, for the agent's build_chart tool. */
export async function listDatasets(env: Env): Promise<{ key: string; name: string; unit: string; n: number }[]> {
  const sql = db(env);
  const rows: any[] = await sql`
    SELECT key, name, canonical_unit, value_count FROM ignis.dataset
     WHERE value_count > 0 ORDER BY value_count DESC, name`;
  return rows.map((r) => ({ key: r.key, name: r.name, unit: r.canonical_unit ?? "", n: Number(r.value_count ?? 0) }));
}

/** Side-by-side comparison of named experiments. */
export async function compareExperiments(env: Env, codes: string[], topic: string | null): Promise<any> {
  const sql = db(env);
  const exps = await sql`SELECT e.*, f.code AS facility_code, f.name AS facility_name, f.platform FROM ignis.experiment e LEFT JOIN ignis.facility f ON f.id = e.facility_id WHERE e.code = ANY(${codes})`;
  if (!exps.length) return { experiments: [], dimensions: [], findings: {}, metric_matrix: [], note: "no matching experiments" };
  const ids = exps.map((e: any) => e.id);
  const findings = await sql.query(`SELECT ed.experiment_id, f.metric, f.value, f.value_max, f.unit, f.statement, ${CONF_SQL_FINDING} AS confidence, d.title, d.source_id FROM ignis.finding f JOIN ignis.experiment_document ed ON ed.document_id = f.document_id JOIN ignis.document d ON d.id = f.document_id WHERE ed.experiment_id = ANY($1) AND ($2::text IS NULL OR f.metric ILIKE '%' || $2::text || '%') ORDER BY ed.experiment_id, f.metric`, [ids, topic]) as any[];
  const docCounts = await sql`SELECT experiment_id, count(*) AS n FROM ignis.experiment_document WHERE experiment_id = ANY(${ids}) GROUP BY experiment_id`;
  const counts = new Map(docCounts.map((r: any) => [r.experiment_id, Number(r.n)]));
  const byExp: Record<string, any> = {};
  for (const f of findings as any[]) {
    (byExp[f.experiment_id] ??= []).push({
      metric: f.metric, value: f.value, value_max: f.value_max, unit: f.unit,
      statement: f.statement, confidence: f.confidence, document_title: f.title, source_id: f.source_id,
    });
  }
  const metricMatrix: Record<string, any> = {};
  for (const e of exps as any[]) for (const f of byExp[e.id] ?? []) {
    (metricMatrix[f.metric] ??= {})[e.id] ??= [];
    metricMatrix[f.metric][e.id].push({ value: f.value, value_max: f.value_max, unit: f.unit });
  }
  return {
    experiments: (exps as any[]).map((e) => ({
      id: e.id, code: e.code, name: e.name, campaign: e.campaign, facility: e.facility_code,
      facility_name: e.facility_name, platform: e.platform, status: e.status, gravity_level: e.gravity_level,
      fuel_type: e.fuel_type, ambient_gas: e.ambient_gas, pressure_kpa: e.pressure_kpa, o2_fraction: e.o2_fraction,
      ignition_source: e.ignition_source, objective: e.objective, summary: e.summary,
      document_count: counts.get(e.id) ?? 0,
    })),
    dimensions: ["campaign", "facility_code", "platform", "status", "gravity_level", "fuel_type", "ambient_gas", "pressure_kpa", "o2_fraction", "ignition_source"],
    findings: Object.fromEntries((exps as any[]).map((e) => [String(e.id), byExp[e.id] ?? []])),
    metric_matrix: Object.entries(metricMatrix).sort(([a], [b]) => a.localeCompare(b)).map(([metric, values]) => ({ metric, values })),
  };
}

/** Experiment codes known to the corpus, for the agent's compare tool. */
export async function knownExperimentCodes(env: Env): Promise<string[]> {
  const sql = db(env);
  const rows: any[] = await sql`SELECT code FROM ignis.experiment WHERE code IS NOT NULL ORDER BY code`;
  return rows.map((r) => String(r.code));
}

/** Fixed pipeline: plan → retrieve → grade → expand → synthesize → verify. */
export async function runAgent(
  env: Env,
  question: string,
  mode: "fast" | "deep",
  model: string | undefined,
  k: number,
  emit: (node: string, data: any) => void,
  conversationId?: string,
  userId?: string | null,
): Promise<any> {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const trace: any[] = [];
  const step = (node: string, data: any) => {
    trace.push({ node, ...data, t_ms: Date.now() - started });
    emit(node, data);
  };

  const answerLanguage = detectScript(question);
  const rq = answerLanguage ? await toEnglishQuery(env, question, model || DEFAULT_FAST_MODEL) : question;
  if (answerLanguage) step("translate", { to: "en", query: rq.slice(0, 160) });

  // memory recall (both modes), scoped to the owner and run.
  let memoryContext = "";
  try {
    const recalled = await memoryRecall(env, rq, 4, conversationId, userId, runId);
    if (recalled.length) {
      memoryContext = recalled.map((r) => `[${r.kind}] ${r.content}`).join("\n");
      step("memory", { n_recalled: recalled.length, contents: recalled.map((r) => r.content) });
    }
  } catch { /* memory is best-effort */ }

  let subs: string[];
  if (mode === "deep") {
    const deepModel = model || env.LAVA_DEEP_MODEL || DEFAULT_FAST_MODEL;
    step("mode", { mode, use_llm: true, provider: "lava-agent", model: deepModel, max_iterations: 2 });
    const planned = await plan(env, rq, deepModel, memoryContext);
    subs = planned.subs;
  } else {
    const fastModel = model || DEFAULT_FAST_MODEL;
    step("mode", { mode, use_llm: true, provider: "lava-agent", model: fastModel, max_iterations: 1 });
    subs = [rq];
  }
  step("plan", { sub_questions: subs });

  const allHits: Hit[] = [];
  for (const sq of subs) {
    const hits = await retrieveGraded(env, sq, mode === "deep" ? 4 : k);
    for (const h of hits) h.sub_question = sq;
    allHits.push(...hits);
    step("retrieve", {
      iteration: 0,
      sub_question: sq,
      n_hits: hits.length,
      verdict: (hits as any).verdict ?? heuristicGrade(hits).verdict,
    });
  }

  // Grade the pooled evidence; if it is thin, expand the query and retry once.
  const seen = new Set<number>();
  let ranked = allHits.filter((h) => { if (seen.has(h.chunk_id)) return false; seen.add(h.chunk_id); return true; });
  ranked.sort((a, b) => b.final_score - a.final_score);
  let relevant = ranked.slice(0, k);

  const pooledGrade = heuristicGrade(relevant);
  step("grade", { verdict: pooledGrade.verdict, score: Number(pooledGrade.score.toFixed(3)), n: relevant.length });

  if (pooledGrade.verdict !== "sufficient") {
    const expanded = expandQuery(rq, new Set(subs));
    step("expand", { from: rq, to: [expanded] });
    const more = await retrieveGraded(env, expanded, k);
    for (const h of more) h.sub_question = expanded;
    const merged = new Map<number, Hit>();
    for (const h of [...relevant, ...more]) {
      const prev = merged.get(h.chunk_id);
      if (!prev || h.final_score > prev.final_score) merged.set(h.chunk_id, h);
    }
    relevant = [...merged.values()].sort((a, b) => b.final_score - a.final_score).slice(0, k);
  }

  const usedModel = model || DEFAULT_FAST_MODEL;
  // Judge the pooled evidence with the SI model before it is synthesised, so the
  // answer is built from the passages that answer the question rather than the
  // ones that merely share its words.
  relevant = await siRerank(env, rq, relevant, usedModel);
  const synth = await synthesizeWithLLM(env, rq, relevant, subs, usedModel);
  const hitsByChunk = new Map(relevant.map((h) => [h.chunk_id, h]));
  const verified = verifyClaims(synth.claims, hitsByChunk);
  const confidence = Math.round(Math.min(0.95, 0.55 * synth.confidence + 0.45 * verified.ratio) * 1000) / 1000;
  step("synthesize", { provider: "lava-agent", model: usedModel, claims: verified.claims.length });
  step("verify", { verified_ratio: Number(verified.ratio.toFixed(3)), claims: verified.claims.length });

  let chart: any = null;
  let answer = normalizeCitationMarkers(synth.answer);
  if (answerLanguage && answer.trim()) {
    answer = await toAnswerLanguage(env, answer, answerLanguage, usedModel);
    step("translate", { to: answerLanguage });
  }
  const evidenceText = relevant.map((h) => h.content ?? "").join(" ").slice(0, 4000);
  const datasetKey = pickDataset(rq, evidenceText);
  if (datasetKey && wantsVisual(rq)) {
    try {
      const built = await buildChart(env, { dataset: datasetKey, type: "bar", limit: 20 });
      if (!("error" in built)) {
        chart = {
          spec: built.spec,
          svg: renderSvg(built.spec),
          rows: built.rows,
          note: "Values are measurements mined from NTRS report text, not a curated NASA dataset.",
        };
        answer = `${answer}\n\n![${built.spec.title}](chart:0)`;
        step("visualize", { dataset: datasetKey, type: built.spec.type, points: built.rows.length });
      }
    } catch (err: any) {
      log("visualize_failed", { message: String(err?.message ?? err).slice(0, 200) });
    }
  }

  const result = {
    run_id: runId,
    question,
    answer,
    chart,
    claims: verified.claims,
    evidence: relevant.map((h) => ({ ...h })),
    sub_questions: subs,
    confidence,
    grounded: Boolean(verified.claims.length) && verified.ratio > 0.3,
    iterations: 1,
    provider: "lava-agent",
    model: usedModel,
    trace,
    latency_ms: Date.now() - started,
  };

  // Session history is written only for a real, caller-supplied conversation.
  if (conversationId) {
    try {
      await persistSession(env, conversationId, question, result, userId);
    } catch (err: any) {
      log("session_persist_failed", { message: String(err?.message ?? err).slice(0, 200) });
    }
  }

  // Persist the durable findings so later questions can recall them.
  try {
    const written = await memoryWrite(env, verified.claims, conversationId, userId, runId);
    if (written) step("memory_write", { n_claims: written });
  } catch { /* best-effort */ }

  return result;
}

/**
 * Run the agentic loop against the live corpus.
 */
export async function runAgentic(
  env: Env,
  question: string,
  mode: "fast" | "deep",
  model: string | undefined,
  k: number,
  emit: (node: string, data: any) => void,
  conversationId?: string,
  userId?: string | null,
): Promise<any> {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const trace: any[] = [];
  const step = (node: string, data: any) => {
    trace.push({ node, ...data, t_ms: Date.now() - started });
    emit(node, data);
  };

  const usedModel = model || env.LAVA_FAST_MODEL || DEFAULT_FAST_MODEL;
  const maxIterations = mode === "deep" ? 8 : 5;
  const deadlineMs = mode === "deep" ? 210000 : 150000;

  step("mode", { mode, use_llm: true, provider: "lava-agent", agent: "react-loop", model: usedModel, max_iterations: maxIterations });

  // The corpus is English, so a question in another script retrieves almost
  // nothing. Translate to English for retrieval, remember the source language so
  // the finished answer can be written back in it.
  const answerLanguage = detectScript(question);
  const retrievalQuestion = answerLanguage ? await toEnglishQuery(env, question, usedModel) : question;
  if (answerLanguage) step("translate", { to: "en", query: retrievalQuestion.slice(0, 160) });

  // A cheap pre-pass puts prior findings in context on turn one.
  let memoryBlock = "";
  try {
    const recalled = await memoryRecall(env, question, 5, conversationId, userId, runId);
    if (recalled.length) {
      memoryBlock = "\n\nPrior findings from earlier sessions (may or may not apply):\n" +
        recalled.map((r: any, i: number) => `(${i + 1}) ${r.content}`).join("\n");
      step("memory", { n_recalled: recalled.length, contents: recalled.map((r: any) => r.content) });
    }
  } catch { /* memory is best-effort */ }

  const known = await knownExperimentCodes(env).catch(() => [] as string[]);

  const loop = await runAgentLoop(
    retrievalQuestion,
    {
      model: usedModel,
      deadlineMs,
      maxIterations,
      context: memoryBlock.trim() || undefined,
      search: (q, kk) => retrieveGraded(env, q, kk) as any,
      recall: async (q, kk) => (await memoryRecall(env, q, kk, conversationId)) as any,
      compare: (codes, topic) => compareExperiments(env, codes, topic),
      datasets: () => listDatasets(env),
      chat: (messages, opts) => llmChat(env, messages as ChatMessage[], usedModel, opts),
      onProgress: (node, data) => step(node, data),
    },
    known,
    (s) => step(s.tool === "final_answer" ? "final" : "act", {
      iteration: s.iteration, thought: s.thought, tool: s.tool, input: s.input,
      n_evidence: s.n_evidence, error: s.error,
    }),
  );

  const relevant = loop.hits as unknown as Hit[];
  const hitsByChunk = new Map(relevant.map((h) => [h.chunk_id, h]));
  const attributed = attributeClaims(loop.answer, relevant);
  const claims = verifyClaims(attributed.claims, hitsByChunk);
  const verifiedRatio = claims.ratio;

  let chart: any = null;
  let answer = normalizeCitationMarkers(attributed.answer);

  if (answerLanguage && answer.trim()) {
    answer = await toAnswerLanguage(env, answer, answerLanguage, usedModel);
    step("translate", { to: answerLanguage });
  }

  if (loop.chartRequest) {
    try {
      const built = await buildChart(env, {
        dataset: loop.chartRequest.dataset,
        type: loop.chartRequest.type,
        limit: 20,
        group_by: "experiment",
      });
      if ("error" in built) {
        step("visualize", { error: built.error });
      } else {
        chart = {
          spec: built.spec,
          svg: renderSvg(built.spec),
          rows: built.rows,
          note: "Values are measurements mined from NTRS report text, not a curated NASA dataset.",
        };
        answer = `${answer}\n\n![${built.spec.title}](chart:0)`;
        step("visualize", { dataset: loop.chartRequest.dataset, type: built.spec.type, points: built.rows.length });
      }
    } catch (err: any) {
      step("visualize", { error: String(err?.message ?? err).slice(0, 160) });
    }
  }

  step("verify", { verified_ratio: Number(verifiedRatio.toFixed(3)), claims: claims.claims.length, stop_reason: loop.stopReason });
  step("synthesize", { provider: "lava-agent", model: usedModel, claims: claims.claims.length, iterations: loop.iterations });

  // Confidence blends how the loop stopped with how many claims the corpus
  // actually supports.
  const modelConfidence =
    loop.stopReason === "final_answer" ? 0.85 :
    loop.stopReason === "forced_synthesis" ? 0.7 :
    loop.stopReason === "budget" ? 0.55 :
    loop.stopReason === "deadline" ? 0.45 :
    loop.stopReason === "synth_failed" ? 0.3 :
    0.3;
  const confidence = Math.round(
    Math.min(0.95, 0.35 * modelConfidence + 0.65 * verifiedRatio) *
    (claims.claims.some((c) => c.attributed) ? 0.88 : 1) * 1000) / 1000;

  const result = {
    run_id: runId,
    question,
    answer,
    chart,
    claims: claims.claims,
    evidence: relevant.map((h) => ({ ...h })),
    sub_questions: loop.steps.filter((s) => s.tool === "search_corpus")
      .map((s) => String(s.input?.query ?? "")).filter(Boolean),
    confidence,
    grounded: Boolean(claims.claims.length) && verifiedRatio > 0.3,
    iterations: loop.iterations,
    stop_reason: loop.stopReason,
    provider: "lava-agent",
    model: usedModel,
    agent: "react-loop",
    trace,
    latency_ms: Date.now() - started,
  };

  if (conversationId) {
    try {
      await persistSession(env, conversationId, question, result, userId);
    } catch (err: any) {
      log("session_persist_failed", { message: String(err?.message ?? err).slice(0, 200) });
    }
  }

  try {
    const written = await memoryWrite(env, claims.claims, conversationId, userId, runId);
    if (written) step("memory_write", { n_claims: written });
  } catch { /* best-effort */ }

  return result;
}