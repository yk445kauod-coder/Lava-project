/**
 * LAVA serverless agentic RAG Worker - request dispatcher.
 *
 * Ports the Python agent (pipeline/lib/agent.py + synth.py + retrieve.py) to
 * Cloudflare Workers so the whole assistant runs "live" on free serverless
 * infra - no VPS, no local Python, no session limits.
 *
 *   POST /ask   { question, mode?: "fast"|"deep", model?, k?, stream:true }
 *
 *   fast → single LLM pass on the raw question
 *   deep → full agentic loop: LLM plan → embed → hybrid search → rerank →
 *          expand thin sub-questions → synthesize → verify claims
 *
 * Stack:
 *   - DB:    Neon Postgres via @neondatabase/serverless (HTTP fetch driver)
 *   - Embed: Workers AI @cf/baai/bge-small-en-v1.5 (matches corpus)
 *   - LLM:   lava-gateway Cloudflare Worker (chat-completions dialect)
 *
 * This file only routes. The handlers live under ./routes and the shared
 * plumbing in ./http, ./db, ./llm, ./retrieval, ./agent, ./report, ./memory,
 * ./i18n, ./sse, and ./serialize. Every response goes through ./http so CORS,
 * the error envelope, and logging stay identical across endpoints.
 */
import type { Env } from "./db";
import { CORS, errorResponse, log, newRequestId } from "./http";
import { currentUser } from "./auth";
import { handleDataRoutes } from "./routes/data";
import { handleAgentRoutes } from "./routes/agent";
import { handleAuthRoutes } from "./routes/auth";
import { handleSessionRoutes } from "./routes/sessions";
import { handleMiscRoutes } from "./routes/misc";

type RouteHandler = (request: Request, url: URL, env: Env) => Promise<Response | null>;

// Order matters only for overlap; the tables are otherwise disjoint.
const ROUTES: RouteHandler[] = [
  handleAuthRoutes,
  handleMiscRoutes,
  handleAgentRoutes,
  handleSessionRoutes,
  handleDataRoutes,
];

/**
 * Endpoints reachable without a session: the public corpus reads that power the
 * landing page, plus auth itself. Everything else - LLM-backed work, exports,
 * memory writes, session history - requires a bearer token, so an anonymous
 * caller cannot spend model budget or read another user's conversations.
 */
const PUBLIC = new Set([
  "/health", "/stats", "/experiments", "/insights", "/documents", "/datasets",
  "/psi", "/global-search", "/search", "/rank", "/locales", "/coverage",
]);
const PUBLIC_PREFIX = [/^\/experiments\//, /^\/documents\//, /^\/datasets\//, /^\/psi\//];

function isPublic(method: string, pathname: string): boolean {
  if (pathname.startsWith("/auth/")) return true;
  // Operator-only routes carry their own shared secret, so they are reachable
  // without a user session; the handler still rejects a bad token.
  if (pathname.startsWith("/admin/")) return true;
  // UI translation is a public helper: it only maps interface strings and lets
  // the multilingual landing page render before sign-in.
  if (method === "POST" && pathname === "/translate") return true;
  // The in-app assistant is a public demo: it answers from the public corpus and
  // writes no per-user state, so a reviewer can try it without signing in.
  if (method === "POST" && (pathname === "/ask" || pathname === "/ask-sync")) return true;
  // Chart and comparison reads power the public Dashboard and Compare pages.
  // Both are plain corpus reads with no model call and no per-user state.
  if (method === "POST" && (pathname === "/visualize" || pathname === "/compare")) return true;
  if (method !== "GET") return false;
  return PUBLIC.has(pathname) || PUBLIC_PREFIX.some((re) => re.test(pathname));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestId = newRequestId();
    const started = Date.now();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      // Auth gate: resolve the caller once, and reject anonymous access to any
      // non-public route before it reaches a handler.
      let user = null;
      if (!isPublic(request.method, url.pathname)) {
        user = await currentUser(request, env);
        if (!user) {
          return new Response(JSON.stringify({ error: "sign in required", code: "unauthorized", request_id: requestId }), {
            status: 401,
            headers: { ...CORS, "content-type": "application/json" },
          });
        }
      }
      (request as any).user = user;

      for (const route of ROUTES) {
        const response = await route(request, url, env);
        if (response) {
          log("request", {
            request_id: requestId,
            method: request.method,
            path: url.pathname,
            status: response.status,
            ms: Date.now() - started,
          });
          response.headers.set("x-request-id", requestId);
          return response;
        }
      }
      return new Response(JSON.stringify({ error: "not found", request_id: requestId }), {
        status: 404,
        headers: { ...CORS, "content-type": "application/json" },
      });
    } catch (err) {
      const response = errorResponse(err, requestId, url.pathname);
      response.headers.set("x-request-id", requestId);
      return response;
    }
  },
};
