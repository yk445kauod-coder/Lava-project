/**
 * Server-sent events for the streaming endpoints.
 *
 * Synthesis calls the LLM for 10-60s without producing an event, and an idle
 * SSE connection is closed by the browser and by edge proxies. A comment frame
 * every 10s costs nothing (SSE clients ignore `:` lines) and keeps the socket
 * warm, which is what stops the "ERR_CONNECTION_CLOSED" seen on /api/ask.
 */
import { CORS } from "./http";

export type Emit = (event: string, data: any) => void;

export function sseResponse(run: (emit: Emit) => Promise<void>): Response {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  const write = (chunk: string) => {
    if (closed) return;
    writer.write(enc.encode(chunk)).catch(() => { closed = true; });
  };
  const emit: Emit = (event, data) => write(`data: ${JSON.stringify({ event, data })}\n\n`);

  const heartbeat = setInterval(() => write(": keep-alive\n\n"), 10000);
  run(emit)
    .catch((err: any) => emit("error", { error: String(err?.message ?? err) }))
    .finally(async () => {
      clearInterval(heartbeat);
      write(`data: ${JSON.stringify({ event: "close" })}\n\n`);
      closed = true;
      try { await writer.close(); } catch { /* client gone */ }
    });

  return new Response(readable, {
    status: 200,
    headers: {
      ...CORS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
