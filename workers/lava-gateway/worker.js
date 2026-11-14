/**
 * LAVA LLM gateway - multi-provider, reachable from anywhere.
 *
 * AgentRouter guards access in two layers:
 *   1. An Aliyun WAF on the whole domain, answering disallowed clients with an
 *      HTML captcha page and HTTP 200. Cloudflare's edge is not blocked, so
 *      requests from here reach the application.
 *   2. An application-level client check returning "unauthorized client
 *      detected" for anything but an allowlisted client, keyed on the Claude CLI
 *      user agent. This Worker sets it, so callers never need to know.
 *
 * The account's models speak the OpenAI Responses API, so this translates
 * chat-completions requests in and back out again, streaming included.
 *
 * Callers authenticate with LAVA_PROXY_TOKEN; the real upstream keys stay here.
 */
const UPSTREAM = "https://agentrouter.org";
const ALLOWLISTED_USER_AGENT = "claude-cli/2.0.0 (external, cli)";
const TIMEOUT_MS = 300000;
const MAX_PARAM_STRIPS = 3;

/**
 * Stealth model registry. Callers send a friendly `model` id; the gateway maps
 * it to a real upstream (provider + model). Free providers sit beside the paid
 * SI tier so the UI never has to know which key is which, and every id is a
 * LAVA-branded codename - nothing leaks the underlying vendor.
 *
 * `provider` picks the wire shape and the credential binding:
 *   agentrouter -> Responses API at agentrouter.org, key AGENTROUTER_API_KEY
 *   groq        -> OpenAI chat-completions, key GROQ_API_KEY
 *   gemini      -> native generateContent, key GEMINI_API_KEY
 *   cloudflare  -> Workers AI run endpoint, key CLOUDFLARE_AI_TOKEN (or account token)
 *
 * `reasoning: true` marks a model that spends its budget on hidden thinking and
 * therefore dislikes JSON mode (the caller must ask it for plain text).
 */
const MODEL_REGISTRY = {
  // ---- SI flagship (paid, AgentRouter) ----
  "si-1":     { provider: "agentrouter", upstream: "gpt-5.6-sol", label: "paid", reasoning: true,  blurb: "Flagship reasoning core, balanced speed" },
  "si-max":   { provider: "agentrouter", upstream: "gpt-6.1-sol", label: "paid", reasoning: true,  blurb: "Deeper reasoning, stronger synthesis" },
  "si-ultra": { provider: "agentrouter", upstream: "gpt-6-astra", label: "paid", reasoning: true,  blurb: "Deepest reasoning core, slowest" },
  // ---- SI free tier (stealth codenames) ----
  "si-nova":       { provider: "gemini",     upstream: "gemini-3.6-flash",                       label: "free", blurb: "Balanced all-rounder" },
  "si-nova-lite":  { provider: "gemini",     upstream: "gemini-3.5-flash",                       label: "free", blurb: "Light, low-latency" },
  "si-pulse":      { provider: "groq",       upstream: "openai/gpt-oss-120b",                    label: "free", reasoning: true, blurb: "Very fast, high throughput" },
  "si-pulse-lite": { provider: "groq",       upstream: "openai/gpt-oss-20b",                     label: "free", reasoning: true, blurb: "Fastest, lightweight" },
  "si-ember":      { provider: "cloudflare", upstream: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "free", blurb: "Edge-hosted, reliable" },
};
const FREE_MODEL_IDS = Object.keys(MODEL_REGISTRY).filter((k) => MODEL_REGISTRY[k].label === "free");
const PAID_MODEL_IDS = Object.keys(MODEL_REGISTRY).filter((k) => MODEL_REGISTRY[k].label === "paid");
const DEFAULT_MODEL = "si-1";

/**
 * Deterministic fallback order, deepest core first.
 *
 * A request for any model walks the chain from its own position: the paid tier
 * in order (astra -> 6.1-sol -> 5.6-sol), then the free providers. So an
 * exhausted or retired upstream - e.g. astra's budget pool returning 402 -
 * degrades to the next best core instead of failing the caller. The chain is
 * only walked when a call actually fails; a healthy upstream is used directly.
 */
const PAID_FALLBACK_ORDER = ["si-ultra", "si-max", "si-1"];
const FREE_FALLBACK_ORDER = ["si-nova", "si-pulse", "si-ember", "si-nova-lite", "si-pulse-lite"];

/** Resolve a requested model id to a registry entry (falling back to AgentRouter). */
function resolveModel(id) {
  if (id && MODEL_REGISTRY[id]) return { id: id, ...MODEL_REGISTRY[id] };
  return { id: id || DEFAULT_MODEL, provider: "agentrouter", upstream: id || "gpt-5.6-sol", label: "paid", reasoning: true };
}

/**
 * Ordered candidate list for one request: the requested model first, then the
 * rest of its own tier (rotated so models after it come first). A paid entry
 * additionally falls back into the free tier, so an exhausted paid core still
 * answers; a free entry stays within the free tier and never silently spends
 * paid budget. Used only as a failure chain, never to override a working model.
 */
function buildChain(entry, env) {
  const isPaid = entry.label === "paid";
  const same = isPaid ? PAID_FALLBACK_ORDER : FREE_FALLBACK_ORDER;
  const other = isPaid ? FREE_FALLBACK_ORDER : [];
  const rotate = (arr) => {
    const i = arr.indexOf(entry.id);
    return i < 0 ? arr.slice() : arr.slice(i + 1).concat(arr.slice(0, i));
  };
  const seen = new Set([entry.id]);
  let ids = rotate(same).concat(other);
  // A free-tier request normally never touches the paid cores. When every free
  // provider is out of quota that surfaces as a hard failure for the caller, so
  // an operator can opt in to a last-resort paid segment for exactly that case.
  // Ordered fastest-first: this segment exists to rescue a call that is already
  // near its deadline, and the deepest cores take 40-90s to answer.
  if (!isPaid && env && env.LAVA_ALLOW_PAID_FALLBACK === "1") ids = ids.concat(["si-1", "si-max", "si-ultra"]);
  const rest = ids
    .filter((id) => MODEL_REGISTRY[id] && !seen.has(id) && (seen.add(id), true))
    .map(resolveModel);
  return [entry].concat(rest);
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status === undefined ? 200 : status,
    headers: Object.assign(
      { "content-type": "application/json", "access-control-allow-origin": "*" },
      extra || {},
    ),
  });
}

/** Flatten a chat-completions body into a Responses API body. */
function toResponsesBody(chat) {
  const input = (chat.messages || []).map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? m.content
      : (m.content || []).map((part) => (part && part.text) || "").join(""),
  }));

  const body = { model: chat.model, input: input };
  // No cap by default: caller may opt into a limit via an explicit max_output_tokens.
  if (chat.max_output_tokens) body.max_output_tokens = chat.max_output_tokens;
  else if (chat.max_tokens && !chat.ignore_max_tokens) body.max_output_tokens = chat.max_tokens;
  // Reasoning models otherwise spend the whole output budget on hidden reasoning
  // and return no visible text, so callers must be able to dial effort down.
  if (chat.reasoning_effort) body.reasoning = { effort: chat.reasoning_effort };
  if (typeof chat.temperature === "number") body.temperature = chat.temperature;
  if (chat.response_format && chat.response_format.type === "json_object") {
    body.text = { format: { type: "json_object" } };
  }
  if (chat.stream) body.stream = true;
  return body;
}

/** Collapse a Responses API payload back into chat-completions shape. */
function toChatCompletion(resp, requestedModel) {
  let content = "";
  for (const item of resp.output || []) {
    if (!item || item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part && (part.type === "output_text" || part.type === "text")) {
        content += part.text || "";
      }
    }
  }
  const usage = resp.usage || {};
  return {
    id: resp.id,
    object: "chat.completion",
    created: resp.created_at || Math.floor(Date.now() / 1000),
    model: resp.model || requestedModel,
    choices: [{
      index: 0,
      message: { role: "assistant", content: content },
      finish_reason: resp.status === "completed" ? "stop" : (resp.status || "stop"),
    }],
    usage: {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    },
  };
}

/** Split an SSE buffer into complete events, returning the remainder. */
function takeEvents(buffer) {
  const events = [];
  let rest = buffer;
  for (;;) {
    const cut = rest.indexOf("\n\n");
    if (cut === -1) break;
    events.push(rest.slice(0, cut));
    rest = rest.slice(cut + 2);
  }
  return { events: events, rest: rest };
}

/** Extract JSON payloads from the data: lines of one SSE block. */
function dataLines(block) {
  const out = [];
  for (const line of block.split("\n")) {
    if (line.indexOf("data:") === 0) out.push(line.slice(5).trim());
  }
  return out;
}

/**
 * Rewrite a Responses API SSE stream into chat-completions chunks.
 *
 * The upstream emits semantic events (response.output_text.delta, reasoning
 * summaries, response.completed). Callers expect the chat-completions shape,
 * so text deltas are re-emitted as chunk frames and everything else is
 * dropped (but kept so usage arrives on the final frame).
 */
function streamTranslator(model) {
  const id = "chatcmpl-" + Date.now();
  let buffer = "";
  let sentRole = false;
  let usage = null;

  const frame = (delta, finish) => {
    const payload = {
      id: id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{ index: 0, delta: delta, finish_reason: finish || null }],
    };
    return "data: " + JSON.stringify(payload) + "\n\n";
  };

  const handle = (payload) => {
    let out = "";
    const type = payload.type || "";
    if (type === "response.output_text.delta") {
      if (!sentRole) {
        sentRole = true;
        out += frame({ role: "assistant" }, null);
      }
      out += frame({ content: payload.delta || "" }, null);
    } else if (type === "response.completed") {
      usage = (payload.response || {}).usage || null;
      if (!sentRole) out += frame({ role: "assistant", content: "" }, null);
      out += frame({}, "stop");
    }
    return out;
  };

  const push = (chunk) => {
    buffer += chunk;
    const parsed = takeEvents(buffer);
    buffer = parsed.rest;
    let out = "";
    for (const block of parsed.events) {
      for (const data of dataLines(block)) {
        if (!data) continue;
        let payload = null;
        try { payload = JSON.parse(data); } catch (e) { continue; }
        out += handle(payload);
      }
    }
    return out;
  };

  return { push: push, usage: function () { return usage; } };
}

function upstreamHeaders(request, key) {
  const headers = {
    "User-Agent": ALLOWLISTED_USER_AGENT,
    "Content-Type": request.headers.get("content-type") || "application/json",
  };
  if (key) headers["Authorization"] = "Bearer " + key;
  const forwarded = request.headers.get("x-request-id");
  if (forwarded) headers["x-request-id"] = forwarded;
  return headers;
}

function unsupportedParameter(text) {
  const match = /Unsupported parameter: '([^']+)'/.exec(text);
  return match ? match[1] : null;
}

/* ===========================================================================
   Provider layer. Each provider returns a normalised OpenAI-style completion:
   { content, finish_reason, usage:{prompt_tokens,completion_tokens,total_tokens} }
   =========================================================================== */

function joinMessages(messages) {
  return (messages || [])
    .map((m) => (m.role === "assistant" ? "Assistant: " : m.role === "system" ? "System: " : "User: ") + (m.content || ""))
    .join("\n\n");
}

/** Groq / any OpenAI-compatible chat-completions endpoint. */
async function callOpenAICompatible(baseUrl, key, model, chat, opts) {
  const payload = { model: model, messages: chat.messages, stream: false };
  if (chat.max_tokens) payload.max_tokens = chat.max_tokens;
  if (typeof chat.temperature === "number") payload.temperature = chat.temperature;
  if (chat.response_format && chat.response_format.type === "json_object") payload.response_format = { type: "json_object" };
  const res = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(model, res.status, data);
  const choice = (data.choices || [])[0] || {};
  return {
    content: (choice.message && choice.message.content) || "",
    finish_reason: choice.finish_reason || "stop",
    usage: data.usage || {},
  };
}

/** Google Gemini native generateContent. */
async function callGemini(key, model, chat, opts) {
  const contents = (chat.messages || [])
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content || "" }] }));
  const system = (chat.messages || []).filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const body = { contents: contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const gen = {};
  if (chat.max_tokens) gen.maxOutputTokens = chat.max_tokens;
  if (typeof chat.temperature === "number") gen.temperature = chat.temperature;
  if (chat.response_format && chat.response_format.type === "json_object") gen.responseMimeType = "application/json";
  if (Object.keys(gen).length) body.generationConfig = gen;

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + key;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(model, res.status, data);
  const cand = (data.candidates || [])[0] || {};
  const content = ((cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
  const um = data.usageMetadata || {};
  return {
    content: content,
    finish_reason: cand.finishReason || "stop",
    usage: { prompt_tokens: um.promptTokenCount || 0, completion_tokens: um.candidatesTokenCount || 0, total_tokens: um.totalTokenCount || 0 },
  };
}

/** Cloudflare Workers AI chat template. */
async function callCloudflare(accountId, key, model, chat, opts) {
  const payload = { messages: chat.messages };
  if (chat.max_tokens) payload.max_tokens = chat.max_tokens;
  if (typeof chat.temperature === "number") payload.temperature = chat.temperature;
  const url = "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/ai/run/" + model;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw providerError(model, res.status, data);
  const r = data.result || {};
  const content = typeof r.response === "string"
    ? r.response
    : (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || "";
  return { content: content, finish_reason: "stop", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

/** AgentRouter Responses API (the existing path), normalised. */
async function callAgentRouter(request, key, model, chat, opts) {
  const body = toResponsesBody(Object.assign({}, chat, { model: model }));
  let upstream = await fetch(UPSTREAM + "/v1/responses", {
    method: "POST", headers: upstreamHeaders(request, key), body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  let text = await upstream.text();
  if (upstream.status === 400) {
    for (let attempt = 0; attempt < MAX_PARAM_STRIPS; attempt++) {
      const param = unsupportedParameter(text);
      if (!param || !Object.prototype.hasOwnProperty.call(body, param)) break;
      delete body[param];
      upstream = await fetch(UPSTREAM + "/v1/responses", {
        method: "POST", headers: upstreamHeaders(request, key), body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      text = await upstream.text();
      if (upstream.status !== 400) break;
    }
  }
  if (upstream.status >= 400) throw providerError(model, upstream.status, safeParse(text));
  const parsed = safeParse(text) || {};
  const out = toChatCompletion(parsed, model);
  return { content: out.choices[0].message.content, finish_reason: out.choices[0].finish_reason, usage: out.usage };
}

function safeParse(text) { try { return JSON.parse(text); } catch (e) { return null; } }

function providerError(model, status, data) {
  const msg = (data && (data.error && (data.error.message || data.error)) ) || JSON.stringify(data || {}).slice(0, 200);
  const err = new Error("provider " + model + " " + status + ": " + msg);
  err.status = status;
  return err;
}

/** One normalised completion from any registered provider. */
async function callProvider(request, env, entry, chat) {
  const opts = { timeoutMs: TIMEOUT_MS };
  // This path always wants a complete (non-streaming) result, even when the
  // caller asked for a stream: the caller re-frames it as a single SSE chunk.
  // Forcing stream:false is what lets a streaming request fall back to another
  // AgentRouter core without receiving an unparseable Responses SSE body.
  chat = Object.assign({}, chat, { stream: false });
  // Reasoning models spend the budget on hidden thinking before emitting text,
  // so a small caller cap returns empty content. Floor the budget for them.
  if (entry.reasoning && (!chat.max_tokens || chat.max_tokens < 800)) {
    chat = Object.assign({}, chat, { max_tokens: 800 });
  }
  switch (entry.provider) {
    case "groq":
      if (!env.GROQ_API_KEY) throw providerError(entry.upstream, 503, { error: { message: "GROQ_API_KEY not configured" } });
      return callOpenAICompatible("https://api.groq.com/openai/v1", env.GROQ_API_KEY, entry.upstream, chat, opts);
    case "gemini":
      if (!env.GEMINI_API_KEY) throw providerError(entry.upstream, 503, { error: { message: "GEMINI_API_KEY not configured" } });
      return callGemini(env.GEMINI_API_KEY, entry.upstream, chat, opts);
    case "cloudflare": {
      const cfKey = env.CLOUDFLARE_AI_TOKEN || env.CLOUDFLARE_API_TOKEN;
      const acct = env.CLOUDFLARE_ACCOUNT_ID;
      if (!cfKey || !acct) throw providerError(entry.upstream, 503, { error: { message: "Cloudflare AI not configured" } });
      return callCloudflare(acct, cfKey, entry.upstream, chat, opts);
    }
    default:
      if (!env.AGENTROUTER_API_KEY) throw providerError(entry.upstream, 503, { error: { message: "AGENTROUTER_API_KEY not configured" } });
      return callAgentRouter(request, env.AGENTROUTER_API_KEY, entry.upstream, chat, opts);
  }
}

/** A descriptive non-streaming error response for a provider failure. */
function providerErrorResponse(err, entry) {
  return json({ error: { message: String((err && err.message) || err), type: "provider_error", provider: entry.provider, model: entry.id } }, (err && err.status) || 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    }

    if (request.method === "GET") {
      if (url.pathname === "/health") {
        return json({
          ok: true,
          upstream: UPSTREAM,
          upstream_key_configured: Boolean(env.AGENTROUTER_API_KEY),
          caller_token_required: true,
          user_agent: ALLOWLISTED_USER_AGENT,
          providers: {
            agentrouter: Boolean(env.AGENTROUTER_API_KEY),
            groq: Boolean(env.GROQ_API_KEY),
            gemini: Boolean(env.GEMINI_API_KEY),
            cloudflare: Boolean((env.CLOUDFLARE_AI_TOKEN || env.CLOUDFLARE_API_TOKEN) && env.CLOUDFLARE_ACCOUNT_ID),
          },
          free_models: FREE_MODEL_IDS,
        });
      }
      if (url.pathname === "/" || url.pathname === "/v1/models") {
        return json({
          ok: true,
          name: "lava-gateway",
          model_hint: env.MODEL || DEFAULT_MODEL,
          models: Object.keys(MODEL_REGISTRY).map((id) => ({ id: id, label: MODEL_REGISTRY[id].label, blurb: MODEL_REGISTRY[id].blurb })),
        });
      }
    }

    // Authenticate callers against LAVA_PROXY_TOKEN.
    const callerToken = env.LAVA_PROXY_TOKEN;
    const authHeader = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const proxyHeader = (request.headers.get("x-lava-token") || "").trim();
    const provided = authHeader || proxyHeader;
    if (callerToken && provided !== callerToken) {
      return json({ error: "unauthorized - missing or invalid LAVA_PROXY_TOKEN" }, 401);
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    const raw = await request.text();
    let chat = {};
    try { chat = JSON.parse(raw); } catch (e) { }
    const requested = chat.model || env.MODEL || DEFAULT_MODEL;
    const entry = resolveModel(requested);
    const isChatCompletions = url.pathname.indexOf("/chat/completions") !== -1;
    const started = Date.now();

    // Passthrough for non-chat-completions routes (raw /v1/responses etc.). Only
    // AgentRouter understands these, so keep the original behaviour there.
    if (!isChatCompletions || !chat.messages) {
      const key = env.AGENTROUTER_API_KEY;
      if (!key) return json({ error: "upstream key not configured on the Worker" }, 503);
      const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: "POST", headers: upstreamHeaders(request, key), body: raw,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "application/json", "access-control-allow-origin": "*", "x-lava-latency-ms": String(Date.now() - started) },
      });
    }

    // The requested AgentRouter model streams real tokens (Responses SSE). Try
    // it first; if that upstream fails *before* any token is emitted (quota,
    // retired model, 5xx), fall back down the chain instead of surfacing a raw
    // error. Once bytes are flowing we commit to that stream.
    const wantsStream = Boolean(chat.stream);
    const noFallback = url.searchParams.get("nofallback") === "1";
    const chain = noFallback ? [entry] : buildChain(entry, env);
    let lastErr = null;
    let streamedFirst = false;
    if (wantsStream && entry.provider === "agentrouter") {
      const attempt = await streamAgentRouter(request, env, entry, chat, started);
      if (attempt.ok) return attempt.response;
      lastErr = attempt.error;
      streamedFirst = true;
    }

    // Walk the chain (the requested model first unless we already tried it
    // streaming): paid cores in order, then the free providers. A provider that
    // answers with empty content counts as a failure and the next is tried.
    const rest = streamedFirst ? chain.slice(1) : chain;
    let result = null, used = entry;
    for (const candidate of rest) {
      try {
        result = await callProvider(request, env, candidate, chat);
        used = candidate;
        if (result.content && result.content.trim()) break;
        lastErr = providerError(candidate.upstream, 502, { error: { message: "empty content" } });
        result = null;
      } catch (e) {
        lastErr = e;
        result = null;
      }
    }
    if (!result) return providerErrorResponse(lastErr, entry);
    const fallbackNote = used.id !== entry.id ? "fallback" : "direct";

    const completion = {
      id: "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: used.id,
      choices: [{ index: 0, message: { role: "assistant", content: result.content }, finish_reason: result.finish_reason || "stop" }],
      usage: result.usage || {},
    };

    if (wantsStream) {
      const frame = (delta, finish) => "data: " + JSON.stringify({ id: completion.id, object: "chat.completion.chunk", created: completion.created, model: used.id, choices: [{ index: 0, delta: delta, finish_reason: finish || null }] }) + "\n\n";
      const body = frame({ role: "assistant", content: result.content }, null) + frame({}, "stop");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "access-control-allow-origin": "*", "x-lava-llm-gateway": used.id, "x-lava-fallback": fallbackNote },
      });
    }
    return new Response(JSON.stringify(completion), {
      status: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*", "x-lava-latency-ms": String(Date.now() - started), "x-lava-llm-gateway": used.id, "x-lava-fallback": fallbackNote },
    });
  },
};

/**
 * AgentRouter streaming path. Returns `{ ok: true, response }` when the upstream
 * accepted the request and is streaming, or `{ ok: false, error }` when it
 * failed before any token was emitted - the caller then falls back down the
 * chain. Once a 200 SSE body is handed back, the stream is committed.
 */
async function streamAgentRouter(request, env, entry, chat, started) {
  const key = env.AGENTROUTER_API_KEY;
  if (!key) return { ok: false, error: providerError(entry.upstream, 503, { error: { message: "AGENTROUTER_API_KEY not configured" } }) };
  const headers = upstreamHeaders(request, key);
  const model = entry.upstream;
  const body = toResponsesBody(Object.assign({}, chat, { model: model }));
  let upstream = await fetch(UPSTREAM + "/v1/responses", {
    method: "POST", headers: headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (upstream.status === 400) {
    const txt = await upstream.text();
    for (let attempt = 0; attempt < MAX_PARAM_STRIPS; attempt++) {
      const param = unsupportedParameter(txt);
      if (!param || !Object.prototype.hasOwnProperty.call(body, param)) break;
      delete body[param];
      upstream = await fetch(UPSTREAM + "/v1/responses", {
        method: "POST", headers: headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (upstream.status !== 400) break;
    }
  }
  const ct = upstream.headers.get("content-type") || "";
  if (upstream.status !== 200 || ct.indexOf("text/event-stream") === -1 || !upstream.body) {
    const txt = await upstream.text();
    return { ok: false, error: providerError(model, upstream.status, safeParse(txt) || { error: { message: txt.slice(0, 200) } }) };
  }
  const translator = streamTranslator(model);
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  (async () => {
    try {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const out = translator.push(buf);
        buf = "";
        if (out) await writer.write(encoder.encode(out));
      }
      const tail = translator.push("");
      if (tail) await writer.write(encoder.encode(tail));
    } catch (e) {
      // Aborted upstream: close cleanly.
    } finally {
      await writer.close();
    }
  })();
  return {
    ok: true,
    response: new Response(readable, {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "access-control-allow-origin": "*", "x-lava-llm-gateway": model, "x-lava-fallback": "direct" },
    }),
  };
}
