/**
 * Shared HTTP plumbing for the LAVA agent Worker.
 *
 * Every route answers through these helpers, so CORS, JSON encoding, the error
 * envelope, and logging look the same no matter which handler produced the
 * response. Keeping them in one place is what makes the API predictable for the
 * dashboard and safe by default: an unexpected error is logged with its request
 * id but never returned to the caller, so database and upstream internals cannot
 * leak.
 */

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};

/** JSON response with the shared CORS policy. */
export function json(obj: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json", ...(extra ?? {}) },
  });
}

/**
 * An error whose message is safe to return to the caller verbatim.
 *
 * Anything that is *not* an ApiError is treated as internal by errorResponse:
 * its message is logged, not returned. Routes throw these for the 4xx cases the
 * caller can act on (missing field, unknown id, unsupported value).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code = "error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code = "bad_request") => new ApiError(400, message, code);
export const notFound = (message: string, code = "not_found") => new ApiError(404, message, code);

/** A transport error that carries the HTTP status so retries can classify it. */
export type StatusError = Error & { status: number };

export function httpError(status: number, message: string): StatusError {
  const err = new Error(message) as StatusError;
  err.status = status;
  return err;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** One structured line per event; `request_id` ties a report back to a log. */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/**
 * Convert a thrown value into a response.
 *
 * ApiError messages are intentional and pass through. Every other error is
 * logged with its real message (plus the request id) and answered with a generic
 * 500 envelope, so a stack trace or SQL fragment never reaches the browser.
 */
export function errorResponse(err: unknown, requestId: string, where: string): Response {
  if (err instanceof ApiError) {
    log("request_error", {
      request_id: requestId, where, status: err.status, code: err.code, message: err.message,
    });
    return json({ error: err.message, code: err.code, request_id: requestId }, err.status);
  }
  const message = err instanceof Error ? err.message : String(err);
  log("request_error", { request_id: requestId, where, status: 500, message });
  return json({ error: "internal error", request_id: requestId }, 500);
}

/** Parse a JSON body, tolerating an empty or malformed one. */
export async function readJson<T = any>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Statuses worth a second attempt: rate limits, upstream hiccups, timeouts. */
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryable(err: unknown): boolean {
  const status = (err as StatusError | undefined)?.status;
  // No status means a network/transport failure (fetch threw), which is retryable.
  return status === undefined || TRANSIENT_STATUS.has(Number(status));
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, err: unknown) => void;
}

/**
 * Retry a request-producing function on transient failures, with exponential
 * backoff and full jitter. The last error is rethrown so callers can still
 * distinguish a hard failure from a recovered one.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 400;
  const maxMs = opts.maxMs ?? 4000;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts - 1) throw err;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt) * (0.5 + Math.random());
      opts.onRetry?.(attempt + 1, err);
      await sleep(backoff, opts.signal);
    }
  }
  throw lastErr;
}
