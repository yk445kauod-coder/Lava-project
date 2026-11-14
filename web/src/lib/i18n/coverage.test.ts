import { describe, expect, it } from "vitest";

import { AR } from "./dict";
import { loadLocale } from "./locales/index";
import { LOCALES } from "./locales";

/**
 * The app ships English as the source language and Arabic as a hand-written
 * dictionary; the other locales are bundled translations of a subset of the
 * same source strings. Two things must hold or a user sees a half-translated
 * screen with no warning:
 *   1. no bundled key is a typo/orphan - every key a locale translates must be
 *      a real source string that Arabic also knows;
 *   2. each locale covers enough of the vocabulary to be usable, not a token
 *      handful of labels.
 */
const MIN_COVERAGE = 0.6;

describe("locale dictionaries", () => {
  const nonAr = LOCALES.filter((l) => l.code !== "en" && l.code !== "ar");

  it("covers a usable share of the vocabulary in every bundled locale", async () => {
    const arKeys = Object.keys(AR);
    expect(arKeys.length).toBeGreaterThan(400);

    for (const { code } of nonAr) {
      const dict = await loadLocale(code);
      const keys = Object.keys(dict);
      expect(keys.length, `${code} has no bundled strings`).toBeGreaterThan(0);

      const orphans = keys.filter((k) => !(k in AR));
      expect(orphans, `${code} translates keys Arabic does not know: ${orphans.join(", ")}`).toEqual([]);

      const covered = keys.filter((k) => AR[k]).length / arKeys.length;
      expect(covered, `${code} covers only ${(covered * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(MIN_COVERAGE);
    }
  });

  it("has no empty translations", async () => {
    for (const { code } of nonAr) {
      const dict = await loadLocale(code);
      const empty = Object.entries(dict).filter(([, v]) => !String(v ?? "").trim());
      expect(empty.map(([k]) => k), `${code} has empty values`).toEqual([]);
    }
  });
});
