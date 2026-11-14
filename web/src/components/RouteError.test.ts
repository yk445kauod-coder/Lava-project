import { describe, expect, it } from "vitest";

import { isStaleChunkError } from "./RouteError";

describe("isStaleChunkError", () => {
  it("matches the error Chrome raises for a chunk served as HTML", () => {
    expect(
      isStaleChunkError(
        new Error(
          "Failed to fetch dynamically imported module: https://lava-project.pages.dev/assets/Login-CtTeizB3.js",
        ),
      ),
    ).toBe(true);
  });

  it("matches Firefox and webpack phrasings", () => {
    expect(
      isStaleChunkError(new Error("error loading dynamically imported module")),
    ).toBe(true);
    expect(isStaleChunkError(new Error("Loading chunk 7 failed."))).toBe(true);
  });

  it("accepts a raw string", () => {
    expect(isStaleChunkError("Importing a module script failed.")).toBe(true);
  });

  it("does not treat unrelated errors as stale", () => {
    expect(isStaleChunkError(new Error("Network request failed"))).toBe(false);
    expect(isStaleChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});
