import { describe, expect, it } from "vitest";

import { parseSseFrame, postSse } from "./sse";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("parseSseFrame", () => {
  it("extracts the data payload", () => {
    expect(parseSseFrame('data: {"a":1}')).toEqual({ a: 1 });
  });
  it("ignores keep-alive comments and other fields", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
    expect(parseSseFrame("event: done")).toBeNull();
  });
  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseSseFrame("data: {not json")).toBeNull();
  });
});

describe("postSse", () => {
  it("delivers every frame in order across chunk boundaries", async () => {
    const events: unknown[] = [];
    const body = streamOf('data: {"n":1}\n\ndata: {"n"', ':2}\n\ndata: {"n":3}\n\n');
    const fake = () => Promise.resolve(new Response(body, { status: 200 }));
    await postSse("/api/ask", { q: "x" }, (e) => events.push(e), fake);
    expect(events).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("skips keep-alive comment frames", async () => {
    const events: unknown[] = [];
    const body = streamOf(": keep-alive\n\ndata: {\"ok\":true}\n\n");
    const fake = () => Promise.resolve(new Response(body, { status: 200 }));
    await postSse("/api/ask", {}, (e) => events.push(e), fake);
    expect(events).toEqual([{ ok: true }]);
  });

  it("throws with the server error message on a non-OK response", async () => {
    const fail = () => Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    await expect(postSse("/api/ask", {}, () => {}, fail)).rejects.toThrow("boom");
  });
});
