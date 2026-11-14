import { describe, expect, it } from "vitest";

import { onRequest } from "../../functions/_middleware";

/** Build a context whose `next()` returns a canned response. */
const ctx = (path: string, response: Response) => ({
  request: new Request(`https://x.dev${path}`),
  next: async () => response,
});

const html = () =>
  new Response("<!doctype html><html></html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const js = () =>
  new Response("export const a = 1;", {
    status: 200,
    headers: { "content-type": "application/javascript" },
  });

describe("asset chunk middleware", () => {
  it("replaces a missing module (SPA fallback HTML) with a reload module", async () => {
    const res = await onRequest(ctx("/assets/Login-CtTeizB3.js", html()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(await res.text()).toContain("lava.chunkFallbackAt");
  });

  it("replaces a straight 404 module the same way", async () => {
    const res = await onRequest(
      ctx("/assets/gone-abc123.js", new Response("not found", { status: 404 })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
  });

  it("passes a real module through untouched", async () => {
    const res = await onRequest(ctx("/assets/index-CzHBfnBj.js", js()));
    expect(await res.text()).toBe("export const a = 1;");
  });

  it("ignores non-module paths even if they fall back to HTML", async () => {
    const res = await onRequest(ctx("/login", html()));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<!doctype html>");
  });

  it("ignores existing CSS assets", async () => {
    const res = await onRequest(
      ctx("/assets/index-x.css", new Response("body{}", { headers: { "content-type": "text/css" } })),
    );
    expect(res.headers.get("content-type")).toContain("text/css");
  });
});
