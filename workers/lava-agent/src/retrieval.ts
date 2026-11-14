/**
 * Retrieval, ranking, and claim verification for the LAVA agent.
 *
 * The corpus lives in Neon Postgres with pgvector. A query goes through hybrid
 * search (vector + keyword, RRF-fused in SQL), a lexical rerank, a weighted
 * smart-rank, and MMR diversification. Every score that fed a decision is kept
 * on the hit so the dashboard can explain a ranking.
 *
 * Embedding runs against a dual backend: the configured default first, falling
 * back to the other. `env.EMBED_BACKEND` selects which is tried first ("openai"
 * → openai then workers-ai, otherwise workers-ai then openai).
 */
import type { Env } from "./db";
import { db } from "./db";
import { renderPsiRow } from "./psiRow";
import { log } from "./http";
import { DEFAULT_FAST_MODEL, isLatinText, llmComplete, parseJsonObject, toEnglishQuery } from "./llm";

const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'\-]*/g;
const STOP = new Set(
  ("a an the and or but if while of to in on for with without from by as at is are was were be been being " +
   "this that these those it its their there here which who whom whose what when where why how not no nor so than then " +
   "we our you your they them he she his her can could may might must shall should will would do does did done have has had " +
   "also such more most other some any each both few many much own same too very s t just don now").split(/\s+/));

export function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/**
 * Light English stemmer, matched to the `english` text-search configuration the
 * corpus is indexed with. Postgres reduces "burning" -> "burn" and "flames" ->
 * "flame" at index time; the rerank has to make the same reduction or it scores
 * a real keyword match as a miss. That mismatch is why short queries used to
 * fall back to raw ts_rank with no lexical signal of their own.
 */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ss")) return w;
  // "analysis"/"analyses" and "basis"/"bases" must reduce to the same stem.
  if (w.endsWith("sis")) return w.slice(0, -3) + "s";
  if (w.endsWith("es")) {
    // "boxes" -> "box" (drop -es), but "flames" -> "flame" (drop only -s).
    const trimmed = w.slice(0, -2);
    w = /(?:s|x|z|ch|sh)$/.test(trimmed) ? trimmed : w.slice(0, -1);
  } else if (w.endsWith("s")) {
    w = w.slice(0, -1);
  }
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("edly")) w = w.slice(0, -4);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ly") && w.length > 4 && !ADVERB_KEEP.has(w)) w = w.slice(0, -2);
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** Words that end in -ly but are not adverbs; stripping would mangle them. */
const ADVERB_KEEP = new Set([
  "family", "only", "early", "daily", "likely", "apply", "supply", "reply",
  "multiply", "imply", "italy", "july", "ugly", "fully", "assembly", "anomaly",
]);

export function queryTerms(question: string): string[] {
  return words(question).map((w) => w.toLowerCase()).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Stemmed, de-duplicated query tokens in order of first appearance. */
export function queryTokens(question: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of queryTerms(question)) {
    const s = stem(w);
    if (s.length > 2 && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

/**
 * Domain synonyms. A researcher and a report rarely use the same word for the
 * same thing ("smoulder" vs "smolder", "quench" vs "extinction"), and the
 * corpus has no embedding to bridge the gap while Workers AI is over quota. The
 * map is applied to the query only - never to the passage - so it widens recall
 * without inflating a passage's coverage of the words the researcher actually
 * typed. Keys and values are stems.
 */
const RAW_SYNONYMS: Record<string, string[]> = {
  smolder: ["smoulder"], smoulder: ["smolder"],
  oxidizer: ["oxidiser"], oxidiser: ["oxidizer"],
  extinction: ["quench", "suppression", "extinguish", "extinguishment"],
  quench: ["extinction", "suppression"], suppress: ["extinction", "quench"],
  extinguish: ["extinction", "quench"],
  ignition: ["autoignition"],
  flammability: ["flammable"], flammable: ["flammability"],
  buoyancy: ["buoyant"],
  radiative: ["radiation"], radiation: ["radiative"],
  concentration: ["fraction"],
  velocity: ["speed", "rate"], speed: ["velocity", "rate"],
  efficacy: ["efficiency", "performance"],
  droplet: ["drop"],
  microgravity: ["weightlessness"],
  spacecraft: ["vehicle", "iss"],
  smoke: ["soot", "aerosol"],
  soot: ["smoke", "aerosol", "particulate"],
  aerosol: ["particulate", "particle"],
};

/** Synonyms keyed by stem, so a lookup never has to re-stem the query token. */
const SYNONYMS: Record<string, string[]> = (() => {
  const out: Record<string, Set<string>> = {};
  for (const [k, vs] of Object.entries(RAW_SYNONYMS)) {
    const key = stem(k);
    const set = out[key] ?? (out[key] = new Set());
    for (const v of vs) set.add(stem(v));
  }
  const flat: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(out)) flat[k] = [...v];
  return flat;
})();

/** Query tokens plus their domain synonyms, de-duplicated. */
export function expandTokens(tokens: string[]): string[] {
  const out = new Set<string>(tokens);
  for (const t of tokens) for (const s of SYNONYMS[t] ?? []) if (s.length > 2) out.add(s);
  return [...out];
}

/** Consecutive stemmed-token pairs, used for phrase and proximity scoring. */
export function queryBigrams(question: string): string[] {
  const toks = queryTerms(question).map(stem).filter((t) => t.length > 2);
  const out: string[] = [];
  for (let i = 0; i + 1 < toks.length; i++) out.push(`${toks[i]} ${toks[i + 1]}`);
  return [...new Set(out)];
}

/**
 * OR-joined tsquery for the lexical leg. `websearch_to_tsquery` ANDs every
 * term, so a single out-of-vocabulary word zeroes the whole match and a long
 * natural-language question matches nothing; joining with OR lets the rank
 * functions (and the fusion) see the passages that match any salient term.
 * Tokens are reduced to `[a-z0-9]` so nothing can be read as tsquery syntax.
 */
export function buildTsQuery(tokens: string[]): string {
  return tokens.filter((t) => /^[a-z0-9]+$/.test(t)).slice(0, 32).join(" OR ");
}

function tokenSet(text: string): Set<string> {
  return new Set(words(text.toLowerCase()).map(stem).filter((t) => t.length > 2));
}

const NOW_YEAR = new Date().getFullYear();

/** A report's publication recency on a 0..1 scale; 0.5 when the date is unknown. */
function freshness(dateStr: string | null): number {
  if (!dateStr) return 0.5;
  const y = Number(String(dateStr).slice(0, 4));
  if (!y || y < 1950 || y > NOW_YEAR + 1) return 0.5;
  return Math.max(0, Math.min(1, 1 - (NOW_YEAR - y) / 40));
}

/** Corpus quality blended with recency, so a fresh, complete report outranks a stub. */
function provenanceScore(quality: number, dateStr: string | null): number {
  return 0.65 * (quality || 0) + 0.35 * freshness(dateStr);
}

const DOMAIN_TERMS = [
  "microgravity", "combustion", "flame", "flammability", "ignition", "extinction",
  "smolder", "smoulder", "soot", "pyrolysis", "oxidizer", "oxidiser", "quenching",
  "fire", "fire-safety", "suppression", "diffusion flame", "premixed", "droplet",
  "burning rate", "flame spread", "limiting oxygen", "loi", "cool flame",
  "spacecraft", "iss", "bass", "saffire", "same", "flex", "sofie", "cfi", "ace",
  "cygnus", "pmma", "sibal", "heptane", "methanol", "decane", "ethylene",
  "buoyancy", "convection", "radiative", "aerosol", "smoke", "detector",
];

/** Single-word terms for set lookup; the multi-word ones are scanned as phrases. */
const DOMAIN_WORDS = new Set(DOMAIN_TERMS.filter((t) => !/[ -]/.test(t)));
const DOMAIN_PHRASES = DOMAIN_TERMS.filter((t) => /[ -]/.test(t));

/**
 * Density of combustion vocabulary in a passage, on 0..1.
 *
 * One pass over the passage's tokens, with the handful of multi-word terms
 * checked by `indexOf` - the previous version ran `split` once per term per
 * passage, which over the ~2k PSI rows was a measurable share of the Worker's
 * CPU budget.
 */
function domainDensity(text: string): number {
  const toks = words(text.toLowerCase());
  if (!toks.length) return 0;
  let hits = 0;
  for (const t of toks) if (DOMAIN_WORDS.has(t) || DOMAIN_WORDS.has(stem(t))) hits++;
  const low = text.toLowerCase();
  for (const p of DOMAIN_PHRASES) {
    for (let i = low.indexOf(p); i !== -1; i = low.indexOf(p, i + 1)) hits++;
  }
  return Math.min(1.0, (hits / toks.length) * 8);
}

function lexicalOverlap(text: string, terms: string[]): number {
  if (!terms.length) return 0;
  const low = text.toLowerCase();
  const hits = terms.filter((t) => low.includes(t)).length;
  return hits / terms.length;
}

interface RankFactors {
  fusion: number; coverage: number; phrase: number; provenance: number; domain: number;
  fusion_raw: number; coverage_raw: number; phrase_raw: number; provenance_raw: number; domain_raw: number;
  exact_overlap: number;
  gate_coverage: number;
}

export interface Hit {
  chunk_id: number; document_id: number; title: string; source_id: string;
  ordinal: number; kind: string; section_path: string | null; content: string;
  vector_score: number; keyword_score: number; fused_score: number;
  rerank_score: number; final_score: number; quality_score: number;
  landing_url: string; published_date: string | null;
  sub_question: string | null; relevance: string;
  factors?: RankFactors;
  /** One line a researcher can read: why this passage sits where it does. */
  why?: string;
  [k: string]: unknown;
}

/**
 * Smart-ranking weights.
 *
 * Retrieval fusion leads, lexical coverage of the query refines it, phrase and
 * proximity matches pull the passages that answer the question to the top, and
 * provenance (quality blended with recency) and combustion-domain density break
 * ties. Exposed so the ranking dashboard can show a reviewer exactly why one
 * passage outranked another.
 */
export const RANK_WEIGHTS = {
  fusion: 0.36, coverage: 0.26, phrase: 0.14, provenance: 0.12, domain: 0.12,
} as const;

/**
 * Least share of the query's words a passage must contain to be returned.
 *
 * Fusion can put a passage near the top on vector or domain affinity alone even
 * when it shares almost nothing with the question - which is how an off-topic
 * query came back with eight confident-looking hits. A passage that matches no
 * query word is not evidence, so it is dropped. Coverage counts a domain
 * synonym at half credit, so a passage that answers with "quenching" where the
 * researcher wrote "extinction" still counts. Short queries are held to a
 * stricter bar: with only one or two content words, a passage that matches just
 * one of them is not evidence, so "how do I cook pasta" (tokens: cook, pasta)
 * no longer returns combustion passages that happen to say "cook".
 */
const RELEVANCE_FLOOR = 0.2;

/**
 * Drop passages that share too little of the query to be evidence. Reuses the
 * coverage `smartRank` already computed when it is available, so the gate adds
 * no second tokenisation pass over the pool.
 */
export function relevanceGate(hits: Hit[], question: string): Hit[] {
  const tokens = queryTokens(question);
  if (!tokens.length) return hits;
  const floor = tokens.length <= 2 ? 1.0 : RELEVANCE_FLOOR;
  return hits.filter((h) => {
    const coverage = h.factors ? h.factors.gate_coverage : gateCoverage(prepare(h.content), tokens);
    return coverage >= floor;
  });
}

function toHit(row: any, subQuestion?: string): Hit {
  return {
    chunk_id: Number(row.chunk_id), document_id: Number(row.document_id),
    title: row.title ?? "", source_id: row.source_id ?? "",
    ordinal: Number(row.ordinal ?? 0), kind: row.kind ?? "body",
    section_path: row.section_path ?? null, content: row.content ?? "",
    vector_score: Number(row.vector_score ?? 0), keyword_score: Number(row.keyword_score ?? 0),
    fused_score: Number(row.fused_score ?? 0), rerank_score: 0, final_score: 0,
    quality_score: row.quality_score != null ? Number(row.quality_score) : 0,
    landing_url: row.landing_url ?? "",
    published_date: row.published_date ?? null,
    sub_question: subQuestion ?? null, relevance: "unrated",
  };
}

/**
 * Embed through the configured backend, falling back to the other when it
 * fails, then normalise the vector to unit length.
 */
export async function embedOne(env: Env, text: string): Promise<number[]> {
  const order: ("openai" | "workers-ai")[] = env.EMBED_BACKEND === "openai"
    ? ["openai", "workers-ai"]
    : ["workers-ai", "openai"];
  let lastErr: unknown;
  for (const backend of order) {
    try {
      const raw = backend === "openai" ? await embedOpenAI(env, text) : await embedWorkersAI(env, text);
      const norm = Math.sqrt(raw.reduce((s, x) => s + x * x, 0)) || 1;
      return raw.map((x) => x / norm);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("embedding failed");
}

async function embedWorkersAI(env: Env, text: string): Promise<number[]> {
  const res: any = await env.AI.run(env.EMBED_MODEL, { text });
  const vec: number[] | undefined = res?.data?.[0];
  if (!vec || !vec.length) throw new Error("embedding failed: empty vector");
  return vec;
}

async function embedOpenAI(env: Env, text: string): Promise<number[]> {
  const base = (env.EMBED_BASE_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("EMBED_BASE_URL is required for the openai embedding backend");
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.EMBED_API_KEY ? { authorization: `Bearer ${env.EMBED_API_KEY}` } : {}),
    },
    body: JSON.stringify({ model: env.EMBED_MODEL_NAME ?? env.DB_EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embedding endpoint ${res.status}`);
  const body: any = await res.json();
  const vec: number[] | undefined = body?.data?.[0]?.embedding;
  if (!vec || !vec.length) throw new Error("embedding failed: empty vector");
  return vec;
}

/**
 * Embed, or `null` when both embedding providers are unavailable (e.g. Workers AI
 * daily-neuron quota exhausted). Callers fall back to keyword-only retrieval
 * rather than returning zero evidence for a question the corpus can answer.
 */
export async function embedSafe(env: Env, text: string): Promise<number[] | null> {
  try {
    return await embedOne(env, text);
  } catch {
    return null;
  }
}

export function toPgVector(vec: number[]): string {
  return "[" + vec.map((x) => x.toFixed(7)).join(",") + "]";
}

const KEYWORD_SQL =
  "SELECT c.id AS chunk_id, c.document_id, d.title, d.source_id, c.ordinal, c.kind, " +
  "c.section_path, c.content, 0::real AS vector_score, k.score AS keyword_score, " +
  "k.score AS fused_score, d.quality_score, d.landing_url, d.published_date " +
  "FROM ignis.search_chunks_keyword($1, $2) k " +
  "JOIN ignis.chunk c ON c.id = k.chunk_id " +
  "JOIN ignis.document d ON d.id = c.document_id " +
  "ORDER BY k.score DESC LIMIT $3";

/**
 * Lexical-only retrieval. Used when embeddings are unavailable, and as the
 * fallback inside `hybridSearch` when a long question's tsquery matches
 * nothing. The query is OR-joined over its stemmed tokens, so one
 * out-of-vocabulary word no longer zeroes the whole match, and `ts_rank_cd`
 * ranks the passages by how much of the query they actually cover.
 */
export async function keywordSearch(env: Env, question: string, k: number, pool = 80): Promise<Hit[]> {
  const sql = db(env);
  const tsq = buildTsQuery(queryTokens(question));
  if (!tsq) return [];
  const rows = await sql.query(KEYWORD_SQL, [tsq, pool, k]);
  return rows.map((r: any) => toHit(r));
}

export async function hybridSearch(env: Env, question: string, qvec: number[],
                                   k: number, pool: number): Promise<Hit[]> {
  const sql = db(env);
  const query =
    "SELECT f.*, d.quality_score, d.landing_url, d.published_date " +
    "FROM ignis.search_chunks_hybrid($1, $2::vector, $3, $4, $5) f " +
    "LEFT JOIN ignis.document d ON d.id = f.document_id " +
    "ORDER BY f.fused_score DESC LIMIT $6";
  // `model_name` must match the value stored in ignis.chunk_embedding, which is
  // the HuggingFace-style id - not the Cloudflare Workers AI binding id. The
  // lexical leg takes an OR-joined tsquery (see buildTsQuery) so it keeps a leg
  // to blend with the vector leg even on a long natural-language question.
  const tsq = buildTsQuery(queryTokens(question));
  const rows = await sql.query(query, [tsq, toPgVector(qvec), k, pool, env.DB_EMBED_MODEL, k]);
  let hits = rows.map((r: any) => toHit(r));

  if (!hits.length) {
    hits = await keywordSearch(env, question, k, pool);
  }
  return hits;
}

/**
 * A passage's text, reduced once to everything the scorer needs: the stemmed
 * token bag, the stemmed token sequence with positions (for proximity), and the
 * raw lowercase string (for quoted phrases). Tokenising each passage a single
 * time is what keeps scoring ~2,000 PSI rows inside the Worker's CPU budget.
 */
interface HitText {
  content: string;
  low: string;
  set: Set<string>;
  stems: string[];
  pos: Map<string, number[]>;
}

function prepare(content: string): HitText {
  const low = content.toLowerCase();
  const stems: string[] = [];
  const pos = new Map<string, number[]>();
  for (const w of words(low)) {
    const t = stem(w);
    stems.push(t);
    if (t.length > 2) {
      const a = pos.get(t);
      if (a) a.push(stems.length - 1); else pos.set(t, [stems.length - 1]);
    }
  }
  return { content, low, set: new Set(stems.filter((t) => t.length > 2)), stems, pos };
}

/** Coverage counting a synonym match at half credit, so an exact hit still wins. */
function coverageSyn(t: HitText, tokens: string[]): number {
  if (!tokens.length) return 0;
  let score = 0;
  for (const tok of tokens) {
    if (t.set.has(tok)) { score += 1; continue; }
    const syns = SYNONYMS[tok];
    if (syns && syns.some((s) => t.set.has(s))) score += 0.5;
  }
  return score / tokens.length;
}

/**
 * Coverage of the query's own tokens, counting a synonym match at full credit.
 * This is the gate's measure: a passage that answers "extinction" with
 * "quenching" is on topic, so the synonym must not read as a miss.
 */
function gateCoverage(t: HitText, tokens: string[]): number {
  if (!tokens.length) return 0;
  let hit = 0;
  for (const tok of tokens) {
    if (t.set.has(tok)) { hit++; continue; }
    const syns = SYNONYMS[tok];
    if (syns && syns.some((s) => t.set.has(s))) hit++;
  }
  return hit / tokens.length;
}

/** Share of the query's token pairs that occur within four words in the passage. */
function proximity(t: HitText, bigrams: string[]): number {
  if (!bigrams.length) return 0;
  let found = 0;
  for (const bg of bigrams) {
    const [a, b] = bg.split(" ");
    const pa = t.pos.get(a), pb = t.pos.get(b);
    if (pa && pb && pa.some((i) => pb.some((j) => Math.abs(i - j) <= 4))) found++;
  }
  return found / bigrams.length;
}

/** Coverage of the passage's opening, where an abstract states the topic. */
function headCoverage(t: HitText, tokens: string[]): number {
  if (!tokens.length) return 0;
  const head = new Set(t.stems.slice(0, 120).filter((x) => x.length > 2));
  return tokens.filter((x) => head.has(x)).length / tokens.length;
}

/** Exact word overlap, on a prepared passage. */
function exactOverlapText(t: HitText, tokens: string[]): number {
  if (!tokens.length) return 0;
  let hit = 0;
  for (const tok of tokens) if (t.set.has(tok)) hit++;
  return hit / tokens.length;
}

/**
 * Cheap cross-encoder substitute: coverage + proximity + position, on the
 * synonym-expanded query. Runs before the weighted blend so the dashboard can
 * show the lexical signal on its own.
 */
export function rerank(question: string, hits: Hit[]): Hit[] {
  const expanded = expandTokens(queryTokens(question));
  const bigrams = queryBigrams(question);
  const phrases = Array.from(question.matchAll(/"([^"]{4,})"/g)).map((m) => m[1].toLowerCase());
  for (const h of hits) {
    const t = prepare(h.content);
    const quoted = phrases.length ? phrases.filter((p) => t.low.includes(p)).length / phrases.length : 0;
    const sectionBonus = ["abstract", "results", "conclusion"].includes(h.kind) ? 0.1 : 0;
    h.rerank_score = Math.min(
      1.0,
      0.5 * coverageSyn(t, expanded) + 0.25 * proximity(t, bigrams)
        + 0.1 * headCoverage(t, expanded) + 0.1 * quoted + sectionBonus,
    );
  }
  return hits;
}

/**
 * Scale a rank-based fusion score into 0..1.
 *
 * `fused_score` is an RRF sum (`Σ 1/(60 + rank)`), so its ceiling depends on
 * how many legs matched: a passage found by both the vector and keyword legs
 * reaches ~0.033, one found by a single leg only ~0.016. Dividing by a fixed
 * ceiling keeps the score comparable across queries - a passage found by both
 * legs always outranks one found by one leg, however large the candidate pool.
 */
export function normalizeFusion(fused: number): number {
  return Math.min(1, Math.max(0, fused / 0.032));
}

export function smartRank(hits: Hit[], question: string): Hit[] {
  if (!hits.length) return hits;
  const tokens = queryTokens(question);
  const expanded = expandTokens(tokens);
  const bigrams = queryBigrams(question);
  for (const h of hits) {
    const t = prepare(h.content);
    const fusion = normalizeFusion(h.fused_score);
    const coverage = coverageSyn(t, expanded);
    const phrase = proximity(t, bigrams);
    const provenance = provenanceScore(h.quality_score, h.published_date);
    const domain = domainDensity(h.content);
    h.final_score =
      RANK_WEIGHTS.fusion * fusion +
      RANK_WEIGHTS.coverage * coverage +
      RANK_WEIGHTS.phrase * phrase +
      RANK_WEIGHTS.provenance * provenance +
      RANK_WEIGHTS.domain * domain;
    // Keep each weighted contribution so the UI can render the score breakdown.
    h.factors = {
      fusion: RANK_WEIGHTS.fusion * fusion,
      coverage: RANK_WEIGHTS.coverage * coverage,
      phrase: RANK_WEIGHTS.phrase * phrase,
      provenance: RANK_WEIGHTS.provenance * provenance,
      domain: RANK_WEIGHTS.domain * domain,
      fusion_raw: fusion,
      coverage_raw: coverage,
      phrase_raw: phrase,
      provenance_raw: provenance,
      domain_raw: domain,
      exact_overlap: exactOverlapText(t, tokens),
      gate_coverage: gateCoverage(t, tokens),
    };
    h.why = explainHit(h, tokens, t.set);
  }
  hits.sort((a, b) => b.final_score - a.final_score);
  return hits;
}

/**
 * How much a passage's SI relevance shifts its final score.
 *
 * The lexical blend above is the floor: it can tell that a passage shares the
 * question's words, not whether it answers the question. The SI pass supplies
 * that judgement. 0.30 is enough to reorder neighbours in the lexical blend
 * without letting the model bury a passage that plainly matches the words.
 */
export const SI_WEIGHT = 0.30;

/** Passages sent to the SI reranker. One pass over the gated evidence. */
const SI_RERANK_DOCS = 10;
/** Characters of each passage the model sees; enough to judge, cheap to send. */
const SI_DOC_CHARS = 700;

/** Collapse whitespace and cut to `n` characters, for a prompt or a label. */
function clamp(text: string, n: number): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) : s;
}

/** Model prose can carry a typographic dash; keep the reason plain text. */
function plainDash(text: string): string {
  return text.replace(/[\u2010-\u2015]/g, "-").replace(/\u2026/g, "...");
}

const SI_RERANK_SYSTEM =
  "You are the ranking stage of a microgravity-combustion research assistant. " +
  "You receive a question and numbered evidence passages, each a document chunk or " +
  "a row of a measured experiment table. Score every passage from 0 to 1 for how " +
  "directly it answers the question: 1 means it contains the answer or the measured " +
  "value, 0 means it is unrelated. Judge relevance only, never writing style. Reply " +
  'with JSON only: {"scores":[{"i":1,"score":0.0,"why":"eight words"}]}.';

/**
 * Re-score the gated evidence with the SI model, the way the challenge's "smart
 * ranking" expects: the lexical blend nominates candidates and the model judges
 * which of them actually answer the question. Runs after the relevance gate so
 * only real candidates are judged, and after MMR so diversification is not
 * undone. A model or parse failure leaves the lexical order untouched.
 */
export async function siRerank(env: Env, question: string, hits: Hit[], model?: string): Promise<Hit[]> {
  if (hits.length < 2) return hits;
  const flag = (env.LAVA_SI_RERANK ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return hits;
  const top = hits.slice(0, SI_RERANK_DOCS);
  const docs = top
    .map((h, i) => `[${i + 1}] ${clamp(h.title || h.source_id, 90)}\n${clamp(h.content, SI_DOC_CHARS)}`)
    .join("\n\n");
  const user = `Question: ${question}\n\nPassages:\n${docs}\n\nScore all ${top.length} passages.`;
  let raw: string;
  try {
    raw = await llmComplete(
      env,
      SI_RERANK_SYSTEM,
      user,
      model || env.LAVA_FAST_MODEL || DEFAULT_FAST_MODEL,
      true,
      900,
      "low",
      25000,
    );
  } catch (err) {
    log("si_rerank_failed", { reason: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    return hits;
  }
  const parsed = parseJsonObject(raw);
  const list = Array.isArray(parsed?.scores) ? parsed.scores : [];
  const scores = new Map<number, { score: number; why: string }>();
  for (const s of list) {
    const idx = Number(s?.i);
    const score = Number(s?.score);
    if (!Number.isInteger(idx) || idx < 1 || idx > top.length) continue;
    if (!Number.isFinite(score)) continue;
    scores.set(idx, { score: Math.min(1, Math.max(0, score)), why: plainDash(String(s?.why ?? "").slice(0, 120)) });
  }
  return applySiScores(hits, scores, top.length);
}

/**
 * Blend the SI scores into the lexical `final_score` and re-sort. Pure, so the
 * weighting can be tested without a model call. Passages the model did not
 * score keep their lexical score and order.
 */
export function applySiScores(
  hits: Hit[],
  scores: Map<number, { score: number; why: string }>,
  scored: number,
): Hit[] {
  if (!scores.size) return hits;
  hits.slice(0, scored).forEach((h, i) => {
    const r = scores.get(i + 1);
    if (!r) return;
    h.si_score = r.score;
    h.final_score = (1 - SI_WEIGHT) * h.final_score + SI_WEIGHT * r.score;
    if (r.why) h.si_why = r.why;
  });
  return hits.slice().sort((a, b) => b.final_score - a.final_score);
}

/**
 * One sentence naming the strongest reason a passage ranked where it did. A
 * trainee reading the results should not have to decode five floating-point
 * factors to see why a passage is here.
 */
function explainHit(h: Hit, tokens: string[], set: Set<string>): string {
  const f = h.factors!;
  const matched = tokens.filter((t) => set.has(t));
  const parts: string[] = [];
  if (matched.length) parts.push(`matches ${matched.slice(0, 5).join(", ")}`);
  if (f.phrase_raw >= 0.5) parts.push("terms appear together");
  if (f.fusion_raw >= 0.5) parts.push("strong keyword and vector match");
  if (f.domain_raw >= 0.5) parts.push("dense combustion vocabulary");
  if (f.provenance_raw >= 0.8) parts.push("high-quality, recent source");
  if (!parts.length) parts.push("weak match on the query terms");
  return parts.slice(0, 2).join("; ");
}

export function mmrDiversify(hits: Hit[], k: number, lambda_ = 0.72): Hit[] {
  if (hits.length <= k) return hits;
  const tokenSets = hits.map((h) => tokenSet(h.content));
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    return inter / (a.size + b.size - inter);
  };
  const selectedIdx: number[] = [];
  const remaining = hits.map((_, i) => i);
  while (remaining.length && selectedIdx.length < k) {
    let best = -1, bestScore = -Infinity;
    for (const i of remaining) {
      let sim = 0;
      for (const j of selectedIdx) sim = Math.max(sim, jaccard(tokenSets[i], tokenSets[j]));
      const score = lambda_ * hits[i].final_score - (1 - lambda_) * sim;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    selectedIdx.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }
  return selectedIdx.map((i) => hits[i]);
}

/** Merge the report corpus with matching PSI table rows so the agent can
 *  ground answers in measured values as well as the papers' prose.
 *
 *  Both sides are ranked on the same weights, so a single sorted merge keeps a
 *  named campaign's measured rows next to the papers that describe it. PSI is
 *  capped at a share of the slots, though: its rows are dense with campaign
 *  labels ("BASS-II", "Spice", "Flame Design"), so on a conceptual question
 *  every row can out-score the prose that actually explains it and fill the
 *  whole list with numbers. Report passages keep the majority; measured rows
 *  take the rest, which is enough to surface real values without burying the
 *  narrative. */
export async function mergePsi<T extends Hit>(env: Env, question: string, corpus: T[], k: number): Promise<T[]> {
  const psi = await psiSearch(env, question, k);
  if (!psi.length) return corpus;
  const merged = capPsiShare([...corpus, ...psi] as unknown as T[], k);
  (merged as any).verdict = (corpus as any).verdict ?? (psi as any).verdict;
  return merged;
}

/** At least two slots for measured data, but never more than a third of the
 *  list; a larger k gives PSI proportionally more room. Pure so it can be
 *  tested without a database. */
export function capPsiShare<T extends Hit>(ranked: T[], k: number): T[] {
  const psiCap = Math.max(2, Math.floor(k / 3));
  const sorted = [...ranked].sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
  const out: T[] = [];
  let psiUsed = 0;
  for (const h of sorted) {
    const isPsi = (h as any).source_type === "psi";
    if (isPsi && psiUsed >= psiCap) continue;
    if (isPsi) psiUsed++;
    out.push(h);
    if (out.length >= k) break;
  }
  return out;
}

/**
 * The English query to search the (English) corpus with.
 *
 * The corpus, its embeddings and its tsvectors are all English, so a question
 * written in another script matches nothing on its own - a bare Arabic query
 * returned zero hits because nothing ever translated it. Non-Latin questions
 * are translated once here, at the top of the retrieval path, so every caller
 * (`/search`, `/rank`, the agent) gets the same cross-lingual behaviour. A
 * translation outage falls back to the original text rather than failing.
 */
export async function retrievalQuery(env: Env, question: string): Promise<string> {
  if (isLatinText(question)) return question;
  try {
    return await toEnglishQuery(env, question, env.LAVA_FAST_MODEL || DEFAULT_FAST_MODEL);
  } catch {
    return question;
  }
}

export async function retrieve(env: Env, question: string, k: number): Promise<Hit[]> {
  const rq = await retrievalQuery(env, question);
  const qvec = await embedSafe(env, rq);
  // Rank a wide pool (not just k) so the reranker has something to reorder;
  // the caller's k only bounds the final diversified selection.
  const pool = Math.max(k * 4, 40);
  const hits = qvec
    ? await hybridSearch(env, rq, qvec, pool, 80)
    : await keywordSearch(env, rq, pool, 80);
  rerank(rq, hits);
  smartRank(hits, rq);
  const relevant = relevanceGate(hits, rq);
  const diversified = mmrDiversify(relevant, k);
  const merged = await mergePsi(env, rq, diversified, k);
  // The SI rerank reads the question in the language it was asked and judges the
  // merged evidence, so a measured PSI row can move above prose that only echoes
  // the question's words.
  return siRerank(env, question, merged);
}

/** Retrieval plus the grading step, so callers can report what happened.
 *
 *  Deliberately stops short of the SI rerank: the agentic loop calls this once
 *  per iteration, and one model pass per iteration would multiply the loop's
 *  latency for an ordering the model does not re-read. The loop's final pool is
 *  reranked once by the caller instead. */
export async function retrieveGraded(env: Env, question: string, k: number): Promise<Hit[]> {
  const rq = await retrievalQuery(env, question);
  const qvec = await embedSafe(env, rq);
  const pool = Math.max(k * 4, 40);
  const raw = qvec
    ? await hybridSearch(env, rq, qvec, pool, 80)
    : await keywordSearch(env, rq, pool, 80);
  rerank(rq, raw);
  smartRank(raw, rq);
  const relevant = relevanceGate(raw, rq);
  const hits = mmrDiversify(relevant, k);
  (hits as any).verdict = heuristicGrade(hits).verdict;
  return mergePsi(env, rq, hits, k);
}


/** Search the NASA PSI (Physical Sciences Informatics) experiment tables
 *  alongside the report corpus. PSI holds the actual measured values behind
 *  the papers as structured rows, so a question naming a quantity or a test
 *  can surface the real numbers instead of only their prose description.
 *
 *  Selection reads the whole PSI set (small, ~2k rows) and scores in memory:
 *  each row is matched on its own values and on its table's metadata, and the
 *  best of the two decides whether it surfaces. Rows are then ranked with the
 *  same rerank/smart-rank used for report passages.
 */
export async function psiSearch(env: Env, question: string, k: number): Promise<Hit[]> {
  const terms = queryTokens(question);
  if (!terms.length) return [];
  const sql = db(env);

  // The PSI set is small (~2k rows across ~22 tables), so read it whole and
  // score in memory. Filtering tables by a metadata FTS first would drop any
  // table whose only match lives in the measured rows (a material, a gas, a
  // test id) - and a metadata match alone is equally a reason to surface the
  // rows. Both cases must survive.
  const tables: any[] = await sql`
    SELECT i.id AS inv_id, i.acronym, i.title AS inv_title, i.doi, i.url,
           i.research_area, i.sub_area, i.project_type,
           t.id AS table_id, t.title AS table_title, t.file_name, t.columns
      FROM ignis.psi_investigation i
      JOIN ignis.psi_experiment_table t ON t.investigation_id = i.id`;
  if (!tables.length) return [];

  const tableIds = tables.map((t) => Number(t.table_id));
  const rows: any[] = await sql`
    SELECT table_id, row_index, test_id, test_date, data
      FROM ignis.psi_test_row
     WHERE table_id = ANY(${tableIds}::bigint[])
     ORDER BY table_id, row_index
     LIMIT 4000`;

  const byTable = new Map<string, any[]>();
  for (const r of rows) {
    const tid = String(r.table_id);
    if (!byTable.has(tid)) byTable.set(tid, []);
    byTable.get(tid)!.push(r);
  }

  const out: Hit[] = [];
  let neg = -1;
  for (const t of tables) {
    const tid = String(t.table_id);
    const tableRows = byTable.get(tid) ?? [];
    if (!tableRows.length) continue;
    // The table's own name is a strong signal; the campaign's broad labels
    // (research area, project type) are shared across nearly every table, so
    // they only sharpen a row that already matched on its name or values -
    // they never make an otherwise-unrelated table surface.
    const specific = [t.acronym, t.inv_title, t.table_title, t.file_name].filter(Boolean).join(" ");
    const broad = [t.research_area, t.sub_area, t.project_type].filter(Boolean).join(" ");
    const metaText = [specific, broad].filter(Boolean).join(" ");
    // Score the table name once, not once per row; the row loop only has to
    // tokenize the row itself.
    const specificScore = coverageSyn(prepare(specific), terms);
    const metaScore = specificScore > 0
      ? Math.max(specificScore, 0.5 * coverageSyn(prepare(broad), terms))
      : 0;
    const cols: string[] = Array.isArray(t.columns) ? t.columns : [];
    for (const r of tableRows) {
      const body = renderPsiRow(r, cols);
      const rowScore = coverageSyn(prepare(body), terms);
      // A question may name the campaign/table or a measured value; either one
      // on its own is enough to surface the row.
      const combined = Math.max(rowScore, metaScore * 0.6);
      if (combined <= 0) continue;
      const invLabel = t.acronym || t.inv_title || "PSI";
      out.push({
        chunk_id: neg, document_id: neg, title: t.table_title || t.file_name,
        source_id: invLabel, ordinal: Number(r.row_index ?? 0), kind: "psi",
        section_path: t.file_name ?? null,
        content: `${metaText} - ${body}`,
        vector_score: 0, keyword_score: combined, fused_score: combined,
        rerank_score: 0, final_score: 0,
        quality_score: 1, // authoritative published data
        landing_url: t.url || (t.doi ? `https://doi.org/${t.doi}` : ""),
        published_date: null, sub_question: null, relevance: "unrated",
        source_type: "psi",
      });
      neg--;
    }
  }
  // Rank the PSI hits the same way as report passages, then take the top k,
  // capping how many rows one spreadsheet can contribute so a single large
  // table cannot fill every slot. `smartRank` is enough here - a second lexical
  // rerank over every row is what pushed these queries past the Worker's CPU
  // budget - and the relevance gate keeps a weakly-matching table out.
  smartRank(out, question);
  const gated = relevanceGate(out, question);
  gated.sort((a, b) => b.final_score - a.final_score);
  const perTable = Math.max(2, Math.ceil(k / 4));
  const seen = new Map<string, number>();
  const ranked: Hit[] = [];
  for (const h of gated) {
    const key = String(h.source_id);
    const n = seen.get(key) ?? 0;
    if (n >= perTable) continue;
    seen.set(key, n + 1);
    ranked.push(h);
    if (ranked.length >= k) break;
  }
  return ranked;
}

export function heuristicGrade(hits: Hit[]): { verdict: string; score: number } {
  if (!hits.length) return { verdict: "insufficient", score: 0 };
  const top = hits.slice(0, 4);
  const best = Math.max(...top.map((h) => h.rerank_score));
  const avg = top.reduce((s, h) => s + h.rerank_score, 0) / top.length;
  // Rerank can be lifted by domain vocabulary a passage shares with the corpus
  // rather than with the question, so a grade of "sufficient" also requires the
  // passage to actually contain the researcher's words.
  const exacts = top.map((h) => h.factors?.exact_overlap ?? 0);
  const bestExact = Math.max(...exacts);
  if (bestExact < 0.2) return { verdict: "insufficient", score: avg };
  if (best >= 0.5 && avg >= 0.3) return { verdict: "sufficient", score: avg };
  if (best >= 0.28) return { verdict: "partial", score: avg };
  return { verdict: "insufficient", score: avg };
}

/**
 * Check that each claim's quote is actually present in the passage it points
 * at. This is a **provenance** check, not entailment: it proves the quote was
 * copied from that passage, nothing more. It cannot tell whether the quote
 * supports the sentence next to it, and a claim that merely shares vocabulary
 * with a passage will pass. The honest grounding signal is `citationCoverage`
 * (how much of the prose cites anything) plus the reader's own eyes on the
 * quote; this function exists so a claim that points at a passage which does
 * not contain it - a mis-numbered citation - is flagged rather than shown.
 *
 * The primary path is an exact substring test (true by construction when we
 * copied the quote ourselves). The fallback is a stem-aware token-overlap
 * ratio, so a quote that was reflowed or lightly reworded by the model still
 * matches its source.
 */
export function verifyClaims(claims: any[], hitsByChunk: Map<number, Hit>): { claims: any[]; ratio: number } {
  let supported = 0;
  for (const c of claims) {
    const hit = hitsByChunk.get(c.chunk_id);
    const quote = (c.quote ?? c.claim ?? "").trim();
    let ok = false;
    if (hit && quote) {
      const chunkLow = hit.content.toLowerCase();
      const probe = quote.toLowerCase().slice(0, 180);
      if (probe && chunkLow.includes(probe)) ok = true;
      else {
        const qt = new Set(words(quote.toLowerCase()).filter((w) => w.length > 3).map(stem));
        const ct = new Set(words(hit.content.toLowerCase()).map(stem));
        if (qt.size) {
          let inter = 0;
          for (const t of qt) if (ct.has(t)) inter++;
          ok = inter / qt.size >= 0.6;
        }
      }
    }
    c.verified = ok;
    if (ok) supported++;
  }
  return { claims, ratio: claims.length ? supported / claims.length : 0 };
}

/**
 * Some models (notably the Groq/OSS cores) emit citation markers with
 * full-width or bracketed punctuation - 【2】, ［2］, (ref 2) - instead of the
 * `[n]` the positional parser and the frontend superscript renderer expect.
 * Normalise them to `[n]`. ASCII `[n]` is left untouched, so this is idempotent.
 */
export function normalizeCitationMarkers(text: string): string {
  return text
    .replace(/[【［\[]\s*(\d+)\s*[】］\]]/g, "[$1]")
    .replace(/[（(]\s*ref\.?\s*(\d+)\s*[）)]/gi, "[$1]");
}

/**
 * Derive claims from the `[n]` markers the model wrote, not from model-authored
 * quote fields. Each marker maps to the passage it points at and quotes that
 * passage, so every claim is grounded by construction and verification cannot
 * fail on a hallucinated quote.
 */
export function claimsFromCitations(answer: string, hits: Hit[]): any[] {
  const normalized = normalizeCitationMarkers(answer);
  const seen = new Set<number>();
  const claims: any[] = [];
  for (const m of normalized.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > hits.length || seen.has(n)) continue;
    seen.add(n);
    const hit = hits[n - 1];
    const quote = hit.content.trim().slice(0, 240);
    claims.push({
      claim: quote, chunk_id: hit.chunk_id, document_id: hit.document_id,
      source_id: hit.source_id, title: hit.title, quote,
      support_score: hit.final_score, landing_url: hit.landing_url,
      section: hit.section_path || hit.kind,
    });
  }
  return claims;
}

/**
 * How strongly the top passages actually answer the question, as opposed to
 * merely sharing its words. `citationCoverage` and `verifyClaims` both measure
 * the *answer's* form (how many sentences cite, whether a quote was copied),
 * and both stay high for a fluent answer that cites a passage which does not
 * answer the question. The one signal that moves with relevance is the rerank
 * score: measured live, an on-topic passage reranks at ~0.58 and an off-topic
 * one ("best chocolate cake recipe") at ~0.13. This maps that mean onto a
 * [0.4, 1] multiplier so an out-of-scope question comes back dampened instead
 * of confident, while an on-topic one is left alone.
 */
export function evidenceStrength(hits: Hit[]): number {
  const scored = hits
    .map((h) => Number(h.si_score ?? h.rerank_score))
    .filter((s) => Number.isFinite(s) && s > 0);
  if (!scored.length) return 1;
  const mean = scored.reduce((a, b) => a + b, 0) / scored.length;
  const LO = 0.2; // mean rerank at or below this is treated as off-topic
  const HI = 0.5; // mean rerank at or above this is treated as fully on-topic
  const FLOOR = 0.4;
  const ramp = FLOOR + ((mean - LO) / (HI - LO)) * (1 - FLOOR);
  return Math.max(FLOOR, Math.min(1, ramp));
}

/**
 * Fraction of answer sentences that carry a citation marker. This is the one
 * grounding signal that is honest and cheap: `verifyClaims` only proves a quote
 * was copied from the passage it points at (true by construction, since we copy
 * the quote ourselves), so a 1.0 there says nothing. Sentence coverage asks the
 * question a reader actually cares about - how much of the prose is tied to a
 * source - and it is low for a fluent answer that cites once, high for one that
 * cites per claim.
 */
export function citationCoverage(answer: string): number {
  const normalized = normalizeCitationMarkers(answer || "");
  const sentences = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/[#*`>|]/g, " ").trim())
    .filter((s) => s.replace(/\W/g, "").length >= 24);
  if (!sentences.length) return 0;
  const cited = sentences.filter((s) => /\[\d+\]/.test(s)).length;
  return cited / sentences.length;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "have",
  "had", "not", "but", "its", "into", "than", "then", "they", "their", "them", "which",
  "when", "while", "also", "such", "can", "may", "more", "most", "some", "any", "all",
  "one", "two", "due", "use", "used", "using", "been", "being", "over", "under", "about",
  "between", "during", "both", "each", "other", "only", "very", "will", "would", "should",
  "could", "there", "these", "those", "however", "therefore", "thus", "here", "does",
]);

function contentWords(text: string): string[] {
  return words(text.toLowerCase()).filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Claims for an answer, plus the answer with citation markers.
 *
 * Prefers the `[n]` markers the model wrote. Reasoning models intermittently
 * omit them - which used to collapse the answer to "0 cited claims / low
 * grounding" even when it was fully evidence-backed - so when there are no
 * markers each sentence is attributed to the passage it overlaps most, the
 * *passage* is quoted (never a model-authored quote), and a `[k]` marker is
 * inserted so the answer still shows inline citations.
 */
export function attributeClaims(answer: string, hits: Hit[]): { claims: any[]; answer: string } {
  const cited = claimsFromCitations(answer, hits);
  if (cited.length || !hits.length) return { claims: cited, answer };

  const text = normalizeCitationMarkers(answer);
  const hitWords = hits.map((h) => new Set(contentWords(h.content)));
  const seen = new Set<number>();
  const claims: any[] = [];

  const markerFor = (sentence: string): string => {
    const sw = new Set(contentWords(sentence));
    if (sw.size < 5) return "";
    let best = -1;
    let bestRatio = 0;
    hits.forEach((_, i) => {
      let inter = 0;
      for (const t of sw) if (hitWords[i].has(t)) inter++;
      const ratio = inter / sw.size;
      if (ratio > bestRatio) { bestRatio = ratio; best = i; }
    });
    if (best < 0 || bestRatio < 0.34 || seen.has(hits[best].chunk_id)) return "";
    seen.add(hits[best].chunk_id);
    const hit = hits[best];
    const quote = hit.content.trim().slice(0, 240);
    claims.push({
      claim: quote, chunk_id: hit.chunk_id, document_id: hit.document_id,
      source_id: hit.source_id, title: hit.title, quote,
      support_score: hit.final_score, landing_url: hit.landing_url,
      section: hit.section_path || hit.kind, attributed: true,
    });
    // The marker is the evidence position (`[3]` -> `hits[2]`), matching how the
    // model's own markers and the frontend resolve citations.
    return ` [${best + 1}]`;
  };

  const sentence = /[^.!?\n]+[.!?]+|[^.!?\n]+$/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = sentence.exec(text))) {
    out += text.slice(last, m.index) + m[0].replace(/[ \t]+$/, "") + markerFor(m[0]);
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return { claims, answer: out };
}

export function synthesizeExtractive(question: string, hits: Hit[]): { answer: string; claims: any[]; confidence: number } {
  if (!hits.length) {
    return {
      answer: "No sufficiently relevant passages were found in the LAVA corpus for this question. Try broadening the query or rephrasing it in combustion terms.",
      claims: [], confidence: 0.1,
    };
  }
  const top = hits.slice(0, 5);
  const answer =
    `${question}\n\nRelevant excerpts from the LAVA corpus (NTRS documents):\n` +
    top.map((h, i) => `[${i + 1}] ${h.title} (NTRS ${h.source_id})\n${h.content.slice(0, 220).trim()}`).join("\n\n");
  const claims = top.slice(0, 3).map((h) => ({
    claim: h.content.slice(0, 180).trim(), chunk_id: h.chunk_id, document_id: h.document_id,
    source_id: h.source_id, title: h.title, quote: h.content.slice(0, 180).trim(),
    support_score: h.final_score, landing_url: h.landing_url, section: h.section_path || h.kind,
  }));
  return { answer, claims, confidence: 0.3 };
}

const EXPANSIONS: Record<string, string[]> = {
  "flame spread": ["flame spread rate", "counterflow flame spread", "opposed flow spread"],
  "extinguish": ["extinction limit", "flame extinguishment", "radiative extinction"],
  "extinction": ["extinction limit", "flame extinguishment", "quenching distance"],
  "ignit": ["ignition delay", "ignition limit", "ignitability"],
  "smoke": ["smoke and soot detection in spacecraft", "smoke particle size"],
  "oxygen": ["limiting oxygen concentration", "oxygen concentration fire safety"],
  "suppression": ["fire suppression", "water mist fire suppression"],
  "safety": ["fire safety", "flammability limits", "fire risk"],
  "radiation": ["radiative heat loss", "surface radiation", "gas band radiation"],
};

export function expandQuery(sub: string, seen: Set<string>): string {
  const low = sub.toLowerCase();
  const additions: string[] = [];
  for (const [stem, variants] of Object.entries(EXPANSIONS)) {
    if (low.includes(stem)) additions.push(...variants.slice(0, 3));
  }
  const unique = [...new Set(additions)].filter((a) => !low.toLowerCase().includes(a.toLowerCase()));
  const expanded = unique.length ? `${sub} ${unique.join(" ")}` : `${sub} microgravity combustion experimental results`;
  seen.add(expanded.toLowerCase());
  return expanded;
}