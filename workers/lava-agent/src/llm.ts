/**
 * LLM access for the LAVA agent Worker.
 *
 * Every model call goes out through the `lava-gateway` Worker, which speaks the
 * OpenAI chat-completions dialect and holds the upstream key. This module owns
 * that hop: the request shape, the reasoning-model quirks (hidden reasoning
 * tokens, JSON mode), and a retry with backoff so a transient upstream hiccup
 * does not surface to the user as a failed answer.
 */
import type { Env } from "./db";
import { httpError, isRetryable, log, sleep, withRetry } from "./http";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Stealth model ids that spend their budget on hidden reasoning. */
const REASONING_MODELS = new Set(["si-1", "si-max", "si-ultra", "si-pulse", "si-pulse-lite"]);
export type ChatOpts = { jsonMode?: boolean; maxTokens?: number; effort?: string; timeoutMs?: number };

/** Default fast model. Kept in one place so every caller agrees on it: `si-1`
 *  is a flagship reasoning core whose 60-90s completions cannot fit the loop's
 *  deadline, which is what pushed runs into the extractive fallback. */
export const DEFAULT_FAST_MODEL = "si-pulse";

/** Call the gateway Worker via its Service Binding (bypasses *.workers.dev 1042). */
export function gatewayFetch(env: Env, path: string, init: RequestInit): Promise<Response> {
  const url = `https://lava-gateway${path}`;
  if (env.GATEWAY) return env.GATEWAY.fetch(url, init);
  return fetch(`${env.LAVA_GATEWAY_URL}${path}`, init);
}

/**
 * One chat completion over an arbitrary message list.
 *
 * The agentic loop needs the model to see its own prior tool calls and their
 * results, which a single system+user pair cannot express. Transient upstream
 * failures (429/5xx, network errors, timeouts) are retried once with backoff;
 * a 4xx is a real request problem and is not retried.
 */
export async function llmChat(
  env: Env,
  messages: ChatMessage[],
  model: string,
  opts: ChatOpts = {},
): Promise<string> {
  const { jsonMode = false, maxTokens = 700, effort = "low", timeoutMs = 75000 } = opts;

  // `timeoutMs` is the budget for the whole call, not for one attempt. A fresh
  // AbortSignal.timeout inside the retry closure would restart the clock on
  // every attempt, so a single synthesis call could run for 2x its timeout and
  // blow past the caller's deadline (a 90s timeout became a ~180s hang).
  const callDeadline = Date.now() + timeoutMs;

  return withRetry(
    async () => {
      const remaining = callDeadline - Date.now();
      if (remaining <= 0) throw httpError(504, `LLM ${model} timed out after ${timeoutMs}ms`);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (env.LAVA_PROXY_TOKEN) headers["authorization"] = `Bearer ${env.LAVA_PROXY_TOKEN}`;
      const payload: Record<string, unknown> = {
        model,
        messages,
        stream: false,
        max_tokens: maxTokens,
        reasoning_effort: effort,
      };
      // Reasoning models (the SI cores) handle structured output poorly and can
      // return empty content, so they are asked for plain markdown and the
      // caller parses it. Non-reasoning models get real JSON mode.
      if (jsonMode && !REASONING_MODELS.has(model)) {
        payload.response_format = { type: "json_object" };
      }

      const res = await gatewayFetch(env, "/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(remaining),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        log("llm_http_error", { model, status: res.status });
        throw httpError(
          res.status,
          `LLM ${model} ${res.status}: ${data?.error?.message ?? JSON.stringify(data).slice(0, 200)}`,
        );
      }
      const choice = data?.choices?.[0];
      const text: string = choice?.message?.content ?? "";
      if (!text.trim()) {
        // A reasoning model can exhaust the budget before emitting any text.
        throw httpError(
          502,
          `LLM ${model} returned empty content (finish_reason=${choice?.finish_reason ?? "unknown"}, tokens=${data?.usage?.completion_tokens ?? "?"})`,
        );
      }
      if (choice?.finish_reason === "incomplete") {
        log("llm_truncated", { model, chars: text.length, tokens: data?.usage?.completion_tokens });
      }
      return text.trim();
    },
    {
      attempts: 2,
      onRetry: (attempt, err) => {
        log("llm_retry", { model, attempt, reason: err instanceof Error ? err.message.slice(0, 120) : String(err) });
      },
    },
  );
}

/** A single system+user completion. */
export function llmComplete(
  env: Env,
  system: string,
  user: string,
  model: string,
  jsonMode = false,
  maxTokens = 700,
  effort = "low",
  timeoutMs = 75000,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  return llmChat(env, messages, model, { jsonMode, maxTokens, effort, timeoutMs });
}

/**
 * Output-token budgets to try for a synthesis call, in order.
 *
 * These models are reasoning models: they bill hidden reasoning against
 * `max_tokens` before emitting any visible text. `si-1` finishes inside
 * ~400 tokens, but `si-max` and `si-ultra` routinely burn 900-1800
 * tokens reasoning and return `finish_reason=incomplete` with empty content at
 * a 900-token cap. Starting them low would guarantee a failed first attempt on
 * every question, so they get a larger opening budget.
 */
export function synthBudgets(model: string): number[] {
  return /astra|6\.1/.test(model) ? [4000, 8000] : [1800, 3500];
}

/** Extract the first JSON object from a model reply, tolerating fences/prose. */
export function parseJsonObject(raw: string): any {
  let s = raw.trim();
  if (s.startsWith("```")) {
    const parts = s.split("```");
    s = (parts[1] || "").replace(/^json/i, "").trim();
  }
  const start = s.indexOf("{");
  if (start !== -1) {
    try {
      return JSON.parse(s.slice(start));
    } catch {
      /* fall through to balanced-brace extraction */
    }
    let depth = 0;
    let i = start;
    let inStr = false;
    let esc = false;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
    }
    if (depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        /* stats repair below */
      }
    }
    // Repair: replace literal control characters that break JSON.stringify/parse.
    const repaired = s.replace(/\n/g, " ").replace(/""/g, '"').replace(/([,\[{])\s*([}\]])/g, "$1$2");
    try {
      return JSON.parse(repaired.slice(repaired.indexOf("{")));
    } catch {
      /* give up */
    }
  }
  return {};
}

export { sleep, isRetryable };

/**
 * Languages the agent answers in directly. A question written in one of these
 * scripts is translated to English for retrieval, then the answer is written
 * back in the question's language.
 */
const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const CJK_SCRIPT = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
const CYRILLIC_SCRIPT = /[\u0400-\u04FF]/;

/** True when the text is mostly Latin script (so it can query the corpus as-is). */
export function isLatinText(text: string): boolean {
  const letters = text.replace(/[^A-Za-z\u00C0-\u024F]/g, "").length;
  const strong = (text.match(/\S/g) || []).length;
  return strong === 0 || letters / strong > 0.6;
}

/** Name of the non-Latin script the question is written in, or null for Latin. */
export function detectScript(text: string): string | null {
  if (ARABIC_SCRIPT.test(text)) return "Arabic";
  if (CJK_SCRIPT.test(text)) return "Chinese";
  if (CYRILLIC_SCRIPT.test(text)) return "Russian";
  return null;
}

/**
 * Arabic scientific terms mapped to the exact English words the corpus uses.
 *
 * The corpus is English and its index is English, so a question written in
 * Arabic has to reach English before it can be searched. A general-purpose
 * translator does that poorly for this domain: it rendered "السناج" (soot) as
 * "Al-Snaj", "الهيبتان" (heptane) as "propane", and a plain question into a
 * refusal sentence. The measured terms are small in number and well known, so
 * they are pinned here and applied before the model ever runs; the model only
 * has to handle the connective prose. Ordered longest-phrase-first so
 * "الجاذبية الصغرى" is matched before "الجاذبية".
 */
const AR_SCIENCE_LEXICON: [string, string][] = [
  ["الجاذبية الصغرى", "microgravity"],
  ["انعدام الجاذبية", "microgravity"],
  ["انتشار اللهب", "flame spread"],
  ["سرعة انتشار اللهب", "flame spread rate"],
  ["معدل انتشار اللهب", "flame spread rate"],
  ["قابلية الاشتعال", "flammability"],
  ["معدل الاحتراق", "burning rate"],
  ["سرعة الاحتراق", "burning rate"],
  ["درجة حرارة الاشتعال", "ignition temperature"],
  ["تأخر الإشعال", "ignition delay"],
  ["زمن تأخر الإشعال", "ignition delay time"],
  ["الاشتعال التلقائي", "autoignition"],
  ["حد الأكسجين", "limiting oxygen"],
  ["تركيز الأكسجين", "oxygen concentration"],
  ["نسبة الأكسجين", "oxygen concentration"],
  ["الأكسجين", "oxygen"],
  ["الهيبتان", "heptane"],
  ["الهكسان", "hexane"],
  ["الميثانول", "methanol"],
  ["الإيثانول", "ethanol"],
  ["الديكان", "decane"],
  ["الإيثيلين", "ethylene"],
  ["الميثان", "methane"],
  ["البروبان", "propane"],
  ["قطرة", "droplet"],
  ["القطرات", "droplets"],
  ["السناج", "soot"],
  ["الهباب", "soot"],
  ["الدخان", "smoke"],
  ["اللهب", "flame"],
  ["الألسنة اللهبية", "flames"],
  ["الاحتراق", "combustion"],
  ["الاشتعال", "ignition"],
  ["الانطفاء", "extinction"],
  ["الإطفاء", "suppression"],
  ["الإخماد", "suppression"],
  ["الانتشار", "spread"],
  ["الطفو", "buoyancy"],
  ["الحمل الحراري", "convection"],
  ["الإشعاع", "radiation"],
  ["الانحلال الحراري", "pyrolysis"],
  ["الحرارة", "temperature"],
  ["الضغط", "pressure"],
  ["السرعة", "velocity"],
  ["الوقود", "fuel"],
  ["الجسيمات", "particles"],
  ["الرذاذ", "aerosol"],
  ["سلامة الحرائق", "fire safety"],
  ["حرائق المركبات الفضائية", "spacecraft fire"],
  ["محطة الفضاء الدولية", "ISS"],
  ["الجاذبية", "gravity"],
  ["المركبة الفضائية", "spacecraft"],
  ["التجربة", "experiment"],
  ["تجربة", "experiment"],
  ["البيانات", "data"],
  ["القياسات", "measurements"],
  ["قياس", "measurement"],
  ["النتائج", "results"],
  ["درجة", "degree"],
  ["دراسة", "study"],
  ["بحث", "research"],
];

/** Latin-script words already present in a mostly-Arabic question (acronyms, ids). */
function latinWords(text: string): string[] {
  return (text.match(/[A-Za-z][A-Za-z0-9-]{1,}/g) ?? []).filter((w) => w.length > 1);
}

/** Replace known Arabic science terms with their English equivalents, longest first. */
export function arabicScienceTerms(text: string): string {
  let out = text;
  for (const [ar, en] of AR_SCIENCE_LEXICON) out = out.split(ar).join(` ${en} `);
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Whether a translated query is safe to search with. The gateway model
 * occasionally answers with a refusal ("I can't help with that") or with a
 * transliteration ("Al-Snaj") instead of a translation; either one poisons the
 * search, so it is rejected and the caller falls back to the original text.
 */
/** A model refusal or a meta-request for more input, never a real translation. */
const NOT_A_TRANSLATION =
  /i (?:can'?t|cannot|can not|am unable|need)|as an ai|i'?m sorry|sorry, i|i apologize|unable to (?:help|assist)|please (?:provide|share|paste|send|write)|could you (?:provide|share|clarify|paste)|provide the (?:full|original|text|sentence|research)|would you like|the (?:text|question|sentence) you|you (?:would like|want) (?:me )?to translate|there (?:is|are) no (?:text|question)|no text (?:was|to)|as a language model/i;

export function looksLikeTranslation(out: string): boolean {
  const s = out.trim();
  if (s.length < 2 || s.length > 240) return false;
  if (ARABIC_SCRIPT.test(s) || CJK_SCRIPT.test(s) || CYRILLIC_SCRIPT.test(s)) return false;
  const words = s.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (!words.length) return false;
  if (NOT_A_TRANSLATION.test(s)) return false;
  return true;
}

const translateCache = new Map<string, string>();

/**
 * A corpus-searchable English query for a question written in another script.
 *
 * The pinned lexicon runs first so the domain words are exact even if the model
 * is wrong or slow; the model then translates whatever prose is left and its
 * result is kept only if it passes `looksLikeTranslation`. Results are cached in
 * memory (the Worker instance is reused across requests) so a repeated question
 * does not pay for the model call, and the call itself is bounded so it cannot
 * stall the retrieval path.
 */
export async function toEnglishQuery(env: Env, question: string, model: string): Promise<string> {
  if (isLatinText(question)) return question;
  const cacheKey = `${model}\u0000${question}`;
  const cached = translateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const seeded = arabicScienceTerms(question);
  let result = seeded;
  // The lexicon already turned this into English (e.g. a single Arabic term that
  // maps straight across) and left no non-Latin script behind. Skip the model
  // call: asking it to "translate" an English phrase is what produced
  // meta-replies like "provide the full research question".
  const needsModel = ARABIC_SCRIPT.test(seeded) || CJK_SCRIPT.test(seeded) || CYRILLIC_SCRIPT.test(seeded);
  if (needsModel) {
    try {
      const raw = await llmComplete(env, TRANSLATE_TO_ENGLISH_SYSTEM, seeded, model, false, 300, "low", 12000);
      const clean = raw
        .replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "")
        .replace(/^(?:translation|english|answer)\s*[:\-]\s*/i, "")
        .replace(/^["'""]+|["'""]+$/g, "")
        .trim();
      if (looksLikeTranslation(clean)) result = clean;
    } catch (err: any) {
      log("translate_failed", { message: String(err?.message ?? err).slice(0, 160) });
    }
  }
  // If neither the lexicon nor the model produced Latin text (e.g. a single
  // Arabic word that is not in the lexicon), keep the acronyms the question
  // already carried rather than searching with raw Arabic that cannot match.
  if (!/[A-Za-z]{2}/.test(result)) {
    const kept = latinWords(question).join(" ");
    if (kept) result = kept;
  }
  if (translateCache.size > 500) translateCache.clear();
  translateCache.set(cacheKey, result);
  return result;
}

const TRANSLATE_TO_ENGLISH_SYSTEM =
  "You translate a scientific research question into English so it can be searched " +
  "against an English NASA corpus. Reply with the English translation only: no quotes, " +
  "no notes, no preamble. Preserve experiment names, acronyms (NTRS, ISS, PMMA, LOC, LOI) " +
  "and units exactly. Keep it a single question or phrase.";

const TRANSLATE_ANSWER_SYSTEM =
  "You translate a scientific research answer into the target language. Preserve markdown " +
  "structure (## headings, - bullets, **bold**, tables) and every citation marker like [3] " +
  "exactly. Keep experiment names, acronyms and units in Latin script. Translate the prose " +
  "only; do not add, drop, or summarise any content. Reply with the translation only.";

/**
 * Translate text through the gateway model. Returns the input unchanged on any
 * failure, so a translation outage degrades to the previous behaviour rather
 * than breaking the request.
 */
async function translate(
  env: Env,
  text: string,
  system: string,
  model: string,
  maxTokens = 1200,
): Promise<string> {
  if (!text.trim()) return text;
  try {
    const out = await llmComplete(env, system, text, model, false, maxTokens, "low", 60000);
    const clean = out.trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
    return clean || text;
  } catch (err: any) {
    log("translate_failed", { message: String(err?.message ?? err).slice(0, 160) });
    return text;
  }
}

/** Final answer written in `language` (the question's language). */
export async function toAnswerLanguage(
  env: Env,
  answer: string,
  language: string,
  model: string,
): Promise<string> {
  const system = `${TRANSLATE_ANSWER_SYSTEM} Target language: ${language}.`;
  return translate(env, answer, system, model, 4000);
}
