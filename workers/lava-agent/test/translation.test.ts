/**
 * Cross-lingual query handling. The corpus and its index are English, so a
 * question written in Arabic has to reach English before it can be searched.
 * These cover the two guards that make that reliable: the pinned science
 * lexicon, and the check that rejects a model reply which is not a translation.
 */
import { describe, expect, test } from "vitest";

import { arabicScienceTerms, isLatinText, looksLikeTranslation } from "../src/llm";

describe("arabicScienceTerms", () => {
  test("maps a multi-word term as a phrase, not word by word", () => {
    expect(arabicScienceTerms("الجاذبية الصغرى")).toContain("microgravity");
    expect(arabicScienceTerms("انتشار اللهب")).toContain("flame spread");
  });

  test("maps the measured substances and quantities", () => {
    const out = arabicScienceTerms("السناج و الهيبتان و تركيز الأكسجين");
    expect(out).toContain("soot");
    expect(out).toContain("heptane");
    expect(out).toContain("oxygen concentration");
  });

  test("leaves Latin acronyms the question carried untouched", () => {
    expect(arabicScienceTerms("تجربة SAFFIRE")).toContain("SAFFIRE");
    expect(arabicScienceTerms("تجربة SAFFIRE")).toContain("experiment");
  });

  test("returns the input unchanged when nothing is in the lexicon", () => {
    expect(arabicScienceTerms("كيف حالك")).toBe("كيف حالك");
  });
});

describe("looksLikeTranslation", () => {
  test("accepts an English sentence", () => {
    expect(looksLikeTranslation("flame spread rate in microgravity")).toBe(true);
  });

  test("rejects a refusal the model sometimes returns instead of a translation", () => {
    expect(looksLikeTranslation("I'm sorry, but I can't help with that.")).toBe(false);
    expect(looksLikeTranslation("As an AI, I cannot translate this.")).toBe(false);
    expect(looksLikeTranslation("I apologize, I am unable to assist.")).toBe(false);
    // A meta-request for more input is not a translation either.
    expect(looksLikeTranslation("Please provide the full research question you would like translated into English.")).toBe(false);
    expect(looksLikeTranslation("Could you share the text you want me to translate?")).toBe(false);
    expect(looksLikeTranslation("There is no text to translate.")).toBe(false);
  });

  test("rejects output that is still in the source script", () => {
    expect(looksLikeTranslation("انتشار اللهب")).toBe(false);
  });

  test("rejects empty or absurdly long output", () => {
    expect(looksLikeTranslation("")).toBe(false);
    expect(looksLikeTranslation("a".repeat(400))).toBe(false);
  });
});

describe("isLatinText", () => {
  test("separates a Latin question from an Arabic one", () => {
    expect(isLatinText("flame spread")).toBe(true);
    expect(isLatinText("معدل انتشار اللهب")).toBe(false);
    // A mostly-Arabic question that carries an acronym is still not Latin.
    expect(isLatinText("تجربة SAFFIRE")).toBe(false);
  });
});
