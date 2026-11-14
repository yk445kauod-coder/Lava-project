/**
 * UI localisation.
 *
 * A three-provider chain resolves short UI strings, cheapest first: Google's
 * public endpoint (one batched request), MyMemory (per-string, capped), then the
 * gateway model for whatever remains. Resolved strings are cached in
 * `ignis.ui_translation` keyed by an MD5 of the English source, so each locale
 * pays for a string once rather than once per page view.
 *
 * Every provider returns one slot per input so the caller keeps position, and
 * unresolved slots come back as null rather than English - that distinction is
 * what stops a failure from being cached as a translation.
 */
import type { Env } from "./db";
import { db } from "./db";
import { log } from "./http";
import { llmComplete, parseJsonObject, DEFAULT_FAST_MODEL } from "./llm";

export const LOCALES: { code: string; name: string; english: string; rtl?: boolean }[] = [
  { code: "en", name: "English", english: "English" },
  { code: "ar", name: "العربية", english: "Arabic", rtl: true },
  { code: "fr", name: "Français", english: "French" },
  { code: "es", name: "Español", english: "Spanish" },
  { code: "de", name: "Deutsch", english: "German" },
  { code: "pt", name: "Português", english: "Portuguese" },
  { code: "ru", name: "Русский", english: "Russian" },
  { code: "zh", name: "中文", english: "Chinese (Simplified)" },
  { code: "ja", name: "日本語", english: "Japanese" },
  { code: "hi", name: "हिन्दी", english: "Hindi" },
];

/** Locale codes the translate endpoint will accept. */
export const LOCALE_CODES = new Set(LOCALES.map((l) => l.code));

const TRANSLATE_SYSTEM =
  "You are a UI localisation engine for a NASA microgravity-combustion research dashboard. " +
  "Translate each English UI string into the target language, one per line. " +
  "Keep it short: these are buttons, headings, labels, and status lines. " +
  "Preserve placeholders, numbers, units (K, kPa, cm/s, %, ppm, nm), and acronyms " +
  "(NASA, NTRS, SAFFIRE, BASS-II, SAME, PDF, DOCX, AI, RAG) exactly as written. " +
  "Do not translate proper nouns. Do not add punctuation that is not implied. " +
  'Reply with JSON only: {"t": ["<translation 1>", "<translation 2>", ...]} with exactly one ' +
  "item per input string, in input order. Never omit an item and never merge two inputs into one.";

async function md5Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};
const unescapeEntities = (s: string) =>
  s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);

/**
 * Google's public translate endpoint.
 *
 * Strings are joined with newlines into a single `q`, which the endpoint splits
 * back into one segment per line - so a whole batch costs one request. Segments
 * are only trusted when the count matches, because a mismatch would silently
 * pair a translation with the wrong source string.
 */
async function googleTranslate(texts: string[], locale: string): Promise<(string | null)[]> {
  // The endpoint splits `q` on newlines into one segment per input, so a
  // multi-line input (an insight body) would add extra segments and break the
  // one-to-one alignment the caller depends on. Collapse internal newlines to
  // spaces before joining; the segment then maps back to the original key.
  const flat = texts.map((t) => t.replace(/\s*\n\s*/g, " "));
  const url = "https://translate.googleapis.com/translate_a/single?" + new URLSearchParams({
    client: "gtx", sl: "en", tl: locale, dt: "t", q: flat.join("\n"),
  });
  // The endpoint throttles bursts with 429; a short backoff clears it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LAVA/1.0)", Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
      throw new Error(`google ${res.status}`);
    }
    if (!res.ok) throw new Error(`google ${res.status}`);
    const data: any = await res.json();
    const segs: string[] = (data?.[0] ?? [])
      .map((s: any) => (Array.isArray(s) ? s[0] : null))
      .filter((s: any) => typeof s === "string");
    // A single input can come back as several segments with no newline between
    // them (a long passage the endpoint splits internally). Joining is then the
    // whole translation, and splitting on newline would lose it.
    if (texts.length === 1) {
      const only = unescapeEntities(segs.join("")).replace(/\s*\n\s*/g, " ").trim();
      return [only && only !== texts[0] ? only : null];
    }
    const joined = unescapeEntities(segs.join("")).split("\n").map((s) => s.trim());
    if (joined.length !== texts.length) {
      throw new Error(`google alignment ${joined.length} != ${texts.length}`);
    }
    return joined.map((s, i) => (s && s !== texts[i] ? s : null));
  }
  throw new Error("google unreachable");
}

/**
 * Google, resilient to a batch that misaligns.
 *
 * A batch of long passages can come back with a segment count that does not
 * match the input count, and the whole slice is then lost. Retry such a slice
 * one string at a time, where a single input's segments simply concatenate.
 */
async function googleTranslateSafe(texts: string[], locale: string): Promise<(string | null)[]> {
  try {
    return await googleTranslate(texts, locale);
  } catch (err: any) {
    if (texts.length === 1) throw err;
    const out: (string | null)[] = [];
    for (const t of texts) {
      try {
        out.push((await googleTranslate([t], locale))[0]);
      } catch {
        out.push(null);
      }
    }
    return out;
  }
}

/**
 * MyMemory: free, per-string, no key. Only used for strings Google could not
 * resolve, and capped, because each string costs its own subrequest.
 */
async function myMemoryTranslate(texts: string[], locale: string): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const t of texts) {
    // The endpoint rejects `q` longer than 500 bytes.
    if (t.length > MYMEMORY_CHARS) { out.push(null); continue; }
    try {
      const url = "https://api.mymemory.translated.net/get?" +
        new URLSearchParams({ q: t, langpair: `en|${locale}` });
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) { out.push(null); continue; }
      const d: any = await res.json();
      const v = d?.responseData?.translatedText;
      if (typeof v !== "string" || !v.trim()) { out.push(null); continue; }
      const decoded = unescapeEntities(v);
      // MyMemory echoes the input when it has no translation for the pair.
      out.push(decoded === t ? null : decoded);
    } catch {
      out.push(null);
    }
  }
  return out;
}

/**
 * Ask the model for translations of one batch.
 *
 * Returns a string per input, or null when the response cannot be trusted. A
 * response with the wrong item count is rejected outright: a short array would
 * silently shift every later string onto the wrong source, which shows up as
 * plausible-looking but wrong UI text.
 */
async function translateBatch(env: Env, locale: string, batch: string[]): Promise<(string | null)[]> {
  const language = LOCALES.find((l) => l.code === locale)?.english ?? locale;
  // Numbered lines keep the model's output aligned with its input, so an input
  // that already contains newlines (an insight body) would split into extra
  // lines and shift every later item. Collapse them first.
  const flat = batch.map((s) => s.replace(/\s*\n\s*/g, " "));
  const numbered = flat.map((s, n) => `${n + 1}. ${s}`).join("\n");
  // A long batch (eight insight bodies) overflows the output budget and comes
  // back as truncated JSON, so scale the budget with the input length.
  const budget = Math.min(8000, Math.max(1500, Math.ceil(numbered.length / 3)));
  try {
    const raw = await llmComplete(
      env, TRANSLATE_SYSTEM,
      `Target language: ${language}\n\n${numbered}`,
      env.LAVA_FAST_MODEL || DEFAULT_FAST_MODEL, true, budget, "low", 60000,
    );
    const parsed = parseJsonObject(raw);
    const arr = Array.isArray(parsed?.t) ? parsed.t : null;
    if (arr && arr.length === batch.length) {
      return arr.map((v: any, i: number) =>
        typeof v === "string" && v.trim() && v.trim() !== flat[i] ? v.trim() : null);
    }
    log("translate_bad_count", { locale, got: arr?.length ?? -1, want: batch.length });
  } catch (err: any) {
    log("translate_llm_failed", { locale, message: String(err?.message ?? err).slice(0, 160) });
  }
  return batch.map(() => null);
}

// Google accepts roughly 8 KB of query string, so a batch is bounded by both a
// node count (short labels) and a character count (long passages an insight
// body or document abstract can exceed on its own).
const GOOGLE_CHUNK = 60;
const GOOGLE_MAX_CHARS = 4000;
const MYMEMORY_CHARS = 450;
// Each MyMemory string is one subrequest, and a Worker invocation gets 50.
const MYMEMORY_MAX = 12;

/** Split strings into Google-safe slices by node count and total length. A
 *  single over-long string still becomes its own slice so it is attempted,
 *  not silently dropped; the endpoint truncates it or the batch is skipped. */
function chunkBySize(batch: string[], maxNodes: number, maxChars: number): { texts: string[]; indexes: number[] }[] {
  const slices: { texts: string[]; indexes: number[] }[] = [];
  let cur: { texts: string[]; indexes: number[] } = { texts: [], indexes: [] };
  let chars = 0;
  batch.forEach((s, i) => {
    const len = s.length + 1;
    if (cur.texts.length && (cur.texts.length >= maxNodes || chars + len > maxChars)) {
      slices.push(cur);
      cur = { texts: [], indexes: [] };
      chars = 0;
    }
    cur.texts.push(s);
    cur.indexes.push(i);
    chars += len;
  });
  if (cur.texts.length) slices.push(cur);
  return slices;
}

/**
 * Resolve a set of strings through the provider chain, cheapest first.
 *
 * Google and MyMemory are machine-translation services, so they are fast and
 * deterministic for short UI labels; the gateway model covers whatever they
 * cannot.
 */
async function translateViaProviders(env: Env, locale: string, batch: string[]): Promise<(string | null)[]> {
  const resolved: (string | null)[] = batch.map(() => null);

  for (const slice of chunkBySize(batch, GOOGLE_CHUNK, GOOGLE_MAX_CHARS)) {
    try {
      const part = await googleTranslateSafe(slice.texts, locale);
      part.forEach((v, n) => { if (v) resolved[slice.indexes[n]] = v; });
    } catch (err: any) {
      log("translate_google_failed", { locale, message: String(err?.message ?? err).slice(0, 120) });
    }
  }

  const googleMisses = batch.map((s, i) => (resolved[i] ? -1 : i)).filter((i) => i >= 0);
  if (googleMisses.length) {
    const slice = googleMisses.slice(0, MYMEMORY_MAX).map((i) => batch[i]);
    try {
      const part = await myMemoryTranslate(slice, locale);
      part.forEach((v, n) => { if (v) resolved[googleMisses[n]] = v; });
    } catch (err: any) {
      log("translate_mymemory_failed", { locale, message: String(err?.message ?? err).slice(0, 120) });
    }
  }

  const llmMisses = batch.map((s, i) => (resolved[i] ? -1 : i)).filter((i) => i >= 0);
  if (llmMisses.length) {
    // Long passages (insight bodies) are chunked so the model's JSON reply is
    // not truncated mid-array; short labels still go in one call.
    for (const slice of chunkBySize(llmMisses.map((i) => batch[i]), 4, 4000)) {
      try {
        const part = await translateBatch(env, locale, slice.texts);
        part.forEach((v, n) => { if (v) resolved[llmMisses[slice.indexes[n]]] = v; });
      } catch (err: any) {
        log("translate_llm_failed", { locale, message: String(err?.message ?? err).slice(0, 120) });
      }
    }
  }

  return resolved;
}

/**
 * Translate UI strings into a locale, cached in `ignis.ui_translation`.
 *
 * Only cache misses reach the model, so the 10 locales cost one batch call each
 * per string rather than one per page view.
 */
export async function translateStrings(env: Env, locale: string, strings: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(strings.map((s) => String(s ?? "")).filter((s) => s.trim()))];
  if (!unique.length) return out;

  // English is the source language: return it verbatim and skip the model.
  if (locale === "en") {
    for (const s of unique) out[s] = s;
    return out;
  }

  const sql = db(env);
  const hashes = await Promise.all(unique.map(md5Hex));
  const hashOf = new Map(unique.map((s, i) => [s, hashes[i]]));

  const cached: any[] = await sql`
    SELECT source_hash, translated FROM ignis.ui_translation
     WHERE locale = ${locale} AND source_hash = ANY(${hashes})`;
  const byHash = new Map(unique.map((s, i) => [hashes[i], s]));
  for (const row of cached) {
    const src = byHash.get(row.source_hash);
    if (src) out[src] = row.translated;
  }

  const missing = unique.filter((s) => !(s in out));
  if (!missing.length) return out;

  // One pass: every provider in the chain sees the whole set, so the number of
  // subrequests stays fixed regardless of how many strings fail to align.
  const resolved = new Map<string, string>();
  const result = await translateViaProviders(env, locale, missing);
  missing.forEach((s, i) => {
    const v = result[i];
    if (v) resolved.set(s, v);
  });

  const rows: { hash: string; source: string; translated: string }[] = [];
  for (const [src, translated] of resolved) {
    out[src] = translated;
    rows.push({ hash: hashOf.get(src)!, source: src, translated });
  }
  // Unresolved strings are deliberately left out of both the response map and
  // the cache: the client falls back to English, and the next request retries
  // instead of serving a permanent English placeholder.
  const unresolved = missing.filter((s) => !resolved.has(s));
  if (unresolved.length) {
    log("translate_unresolved", { locale, unresolved: unresolved.length, missing: missing.length });
  }
  if (rows.length) {
    // One statement per batch via UNNEST: the driver is a tagged-template client,
    // so a per-row INSERT would mean one round trip per string.
    try {
      await sql`
        INSERT INTO ignis.ui_translation (locale, source_hash, source_en, translated)
        SELECT ${locale}, h, s, tr
          FROM unnest(${rows.map((r) => r.hash)}::text[],
                      ${rows.map((r) => r.source)}::text[],
                      ${rows.map((r) => r.translated)}::text[]) AS x(h, s, tr)
        ON CONFLICT (locale, source_hash) DO NOTHING`;
    } catch (err: any) {
      log("translate_cache_write_failed", { locale, message: String(err?.message ?? err).slice(0, 300) });
    }
  }
  return out;
}
