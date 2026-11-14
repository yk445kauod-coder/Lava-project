/** Shapes shared by every component that talks to the LAVA agent. The worker
 *  returns Postgres `bigint`/`numeric` over the Neon HTTP driver as strings, so
 *  numeric fields are typed `unknown` and must go through `lib/format`. */

export interface Hit {
  chunk_id: number;
  title: string;
  source_id: string;
  section_path?: string | null;
  kind?: string | null;
  content: string;
  final_score: number;
  vector_score?: unknown;
  keyword_score?: unknown;
  rerank_score?: unknown;
  relevance?: string | null;
  /** Plain-language reason this passage ranked where it did. */
  why?: string;
  landing_url?: string | null;
  sub_question?: string;
}

export interface Claim {
  title?: string;
  source_id?: string;
  section?: string | null;
  quote?: string;
  support_score?: unknown;
  verified?: boolean;
  landing_url?: string | null;
}

export interface AskResult {
  answer?: string;
  stop_reason?: string;
  confidence?: unknown;
  grounded?: boolean;
  model?: string;
  latency_ms?: unknown;
  run_id?: string;
  evidence?: Hit[];
  claims?: Claim[];
  sub_questions?: string[];
  trace?: { node: string }[] & Record<string, unknown>[];
  chart?: { svg?: string; note?: string; spec?: unknown } | null;
}

/** One live pipeline event emitted over SSE while a run is in flight. */
export interface StageStep {
  node: string;
  data: Record<string, unknown>;
}
