/**
 * Database access for the LAVA agent Worker.
 *
 * The Neon HTTP driver is stateless - each `sql` template call is one fetch - so
 * a single client instance can be built once per isolate and reused instead of
 * reconstructed on every request. The connection string arrives as a Worker
 * secret; a missing one is a configuration fault that should fail loudly.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { ApiError } from "./http";

/** The Worker bindings this code reads. Secrets are optional at type level. */
export interface Env {
  AI: any;
  GATEWAY?: { fetch: typeof fetch };
  LAVA_GATEWAY_URL: string;
  LAVA_PROXY_TOKEN?: string;
  NEON_DATABASE_URL?: string;
  EMBED_MODEL: string;
  DB_EMBED_MODEL: string;
  DB_QUERY_FN?: string;
  LAVA_DEEP_MODEL?: string;
  LAVA_FAST_MODEL?: string;
  MODEL?: string;
  /** Set to "0" or "false" to skip the SI rerank stage and keep lexical order. */
  LAVA_SI_RERANK?: string;
  /** Shared secret that authorises the SI insight-refresh route. */
  LAVA_INSIGHT_TOKEN?: string;
  EMBED_BACKEND?: string;
  EMBED_BASE_URL?: string;
  EMBED_API_KEY?: string;
  EMBED_MODEL_NAME?: string;
}

export type Sql = NeonQueryFunction<false, false>;

let cached: Sql | null = null;
let cachedUrl: string | null = null;

/** Memoized Neon client. Rebuilt only if the connection string changes. */
export function db(env: Env): Sql {
  const url = env.NEON_DATABASE_URL;
  if (!url) {
    throw new ApiError(503, "database is not configured", "db_unconfigured");
  }
  if (!cached || cachedUrl !== url) {
    cached = neon(url);
    cachedUrl = url;
  }
  return cached;
}
