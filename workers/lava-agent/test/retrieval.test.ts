/**
 * Ranking primitives: tokenizing, the English stemmer that mirrors the corpus
 * tsvector, the OR tsquery, the relevance features, and the smart-rank blend.
 *
 * The stemmer is asserted by its property - every inflected form of a term must
 * reduce to the same key, so a query and the passage it matches agree - not by
 * the exact Snowball output, which only Postgres needs to reproduce.
 */
import { describe, expect, test } from "vitest";

import {
  RANK_WEIGHTS, buildTsQuery, expandTokens, heuristicGrade, mmrDiversify,
  normalizeFusion, queryBigrams, queryTerms, queryTokens, relevanceGate, rerank,
  applySiScores, capPsiShare, smartRank, stem, type Hit,
} from "../src/retrieval";

function hit(id: number, content: string, opts: Partial<Hit> = {}): Hit {
  return {
    chunk_id: id, document_id: id, title: `Doc ${id}`, source_id: String(id),
    ordinal: 0, kind: "body", section_path: "Body", content,
    vector_score: 0, keyword_score: 0, fused_score: 0.02, rerank_score: 0,
    final_score: 0, quality_score: 0.5, landing_url: "", published_date: null,
    sub_question: null, relevance: "unrated", ...opts,
  };
}

describe("stemmer", () => {
  test("reduces inflected forms of a term to one key", () => {
    for (const forms of [
      ["flame", "flames"],
      ["burn", "burns", "burning", "burned"],
      ["spread", "spreads", "spreading"],
      ["body", "bodies"],
      ["box", "boxes"],
    ] as const) {
      const keys = new Set(forms.map((f) => stem(f)));
      expect(keys.size, `forms of ${forms[0]} should share one key: ${[...keys]}`).toBe(1);
    }
  });

  test("leaves numbers and short tokens untouched", () => {
    expect(stem("o2")).toBe("o2");
    expect(stem("1g")).toBe("1g");
    expect(stem("loi")).toBe("loi");
  });
});

describe("query parsing", () => {
  test("queryTerms drops stopwords", () => {
    expect(queryTerms("How does the flame spread?")).toEqual(["flame", "spread"]);
  });

  test("queryTokens de-duplicates stems", () => {
    expect(queryTokens("flames flame burning")).toEqual([stem("flame"), stem("burn")]);
  });

  test("buildTsQuery OR-joins safe tokens and drops tsquery syntax", () => {
    expect(buildTsQuery(["flame", "spread", "rate"])).toBe("flame OR spread OR rate");
    // A word carrying tsquery punctuation must not survive as an operator.
    expect(buildTsQuery(["flame", "a&b", "spread"])).toBe("flame OR spread");
    expect(buildTsQuery([])).toBe("");
  });

  test("an Arabic query yields no lexical tokens on its own", () => {
    // The corpus, its tsvectors and its embeddings are English, so an
    // untranslated Arabic question matches nothing; retrievalQuery() translates
    // it first. This test pins the reason that step exists.
    const arabic = "معدل انتشار اللهب في الجاذبية الصغرى";
    expect(queryTokens(arabic)).toEqual([]);
    expect(buildTsQuery(queryTokens(arabic))).toBe("");
  });

  test("queryBigrams pairs adjacent salient tokens", () => {
    expect(queryBigrams("flame spread rate")).toEqual([
      `${stem("flame")} ${stem("spread")}`, `${stem("spread")} ${stem("rate")}`,
    ]);
  });
});

describe("fusion normalisation", () => {
  test("maps a two-leg RRF sum near 1 and clamps out of range", () => {
    expect(normalizeFusion(0.032)).toBe(1);
    expect(normalizeFusion(0.016)).toBeCloseTo(0.5, 9);
    expect(normalizeFusion(0.5)).toBe(1);
    expect(normalizeFusion(0)).toBe(0);
  });
});

describe("rerank", () => {
  test("prefers full query coverage over partial coverage", () => {
    const q = "flame spread rate microgravity";
    const full = hit(1, "The flame spread rate in microgravity was measured.");
    const partial = hit(2, "The flame was visible in the chamber.");
    rerank(q, [full, partial]);
    expect(full.rerank_score).toBeGreaterThan(partial.rerank_score);
  });

  test("rewards terms that appear near each other", () => {
    const q = "limiting oxygen concentration";
    const adjacent = hit(1, "The limiting oxygen concentration limit was recorded.");
    const scattered = hit(2, "The oxygen supply was limited, and the concentration in the tank varied with the limit set by the controller.");
    rerank(q, [adjacent, scattered]);
    expect(adjacent.rerank_score).toBeGreaterThan(scattered.rerank_score);
  });
});

describe("smartRank", () => {
  test("blends the signals and sorts descending", () => {
    const q = "flame spread microgravity";
    const strong = hit(1, "flame spread microgravity flame spread microgravity", { fused_score: 0.032, quality_score: 0.9 });
    const weak = hit(2, "unrelated text about accounting and budgets", { fused_score: 0.004, quality_score: 0.1 });
    const ranked = smartRank(rerank(q, [strong, weak]), q);
    expect(ranked[0].chunk_id).toBe(1);
    expect(ranked[0].final_score).toBeGreaterThan(ranked[1].final_score);
    expect(ranked.every((h) => h.final_score >= 0 && h.final_score <= 1)).toBe(true);
    expect(ranked[0].factors!.coverage_raw).toBeGreaterThan(0);
  });

  test("keeps scores bounded even with a huge fusion outlier", () => {
    const q = "soot";
    const ranked = smartRank(rerank(q, [hit(1, "soot soot soot", { fused_score: 99 })]), q);
    expect(ranked[0].final_score).toBeLessThanOrEqual(1);
  });

  test("weights sum to one so the blend stays a 0..1 score", () => {
    const sum = Object.values(RANK_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });
});

describe("siRerank blend", () => {
  test("the SI judgement can lift a passage above the lexical order", () => {
    const a = hit(1, "flame spread in microgravity", { final_score: 0.62 });
    const b = hit(2, "a passing mention of flame spread", { final_score: 0.60 });
    const out = applySiScores([a, b], new Map([
      [1, { score: 0.2, why: "weak" }],
      [2, { score: 0.95, why: "answers it" }],
    ]), 2);
    expect(out[0].chunk_id).toBe(2);
    expect(out[0].si_score).toBeCloseTo(0.95, 6);
    expect(out[0].si_why).toBe("answers it");
  });

  test("the SI term is weighted, not a takeover", () => {
    // A passage the model scores 0 cannot fall below the weighted floor of its
    // lexical score, so a plain keyword match is never buried entirely.
    const a = hit(1, "x", { final_score: 0.8 });
    const out = applySiScores([a], new Map([[1, { score: 0, why: "no" }]]), 1);
    expect(out[0].final_score).toBeCloseTo(0.7 * 0.8, 6);
  });

  test("no scores leaves the order untouched", () => {
    const hits = [hit(1, "a", { final_score: 0.9 }), hit(2, "b", { final_score: 0.4 })];
    expect(applySiScores(hits, new Map(), 2)).toBe(hits);
  });
});

describe("capPsiShare", () => {
  test("report prose keeps the majority of the slots", () => {
    // PSI rows out-score every report passage, as campaign labels make them do.
    const ranked = [
      hit(1, "psi a", { final_score: 0.9, source_type: "psi" } as Partial<Hit>),
      hit(2, "psi b", { final_score: 0.8, source_type: "psi" } as Partial<Hit>),
      hit(3, "psi c", { final_score: 0.7, source_type: "psi" } as Partial<Hit>),
      hit(4, "psi d", { final_score: 0.6, source_type: "psi" } as Partial<Hit>),
      hit(5, "paper", { final_score: 0.5 }),
      hit(6, "paper", { final_score: 0.4 }),
      hit(7, "paper", { final_score: 0.3 }),
      hit(8, "paper", { final_score: 0.2 }),
    ];
    const out = capPsiShare(ranked, 6);
    expect(out.length).toBe(6);
    const psi = out.filter((h) => (h as any).source_type === "psi");
    expect(psi.length).toBe(2); // floor(6/3) = 2
    expect(out.filter((h) => (h as any).source_type !== "psi").length).toBe(4);
  });

  test("always leaves room for at least two measured rows", () => {
    const ranked = [
      hit(1, "psi", { final_score: 0.9, source_type: "psi" } as Partial<Hit>),
      hit(2, "psi", { final_score: 0.8, source_type: "psi" } as Partial<Hit>),
      hit(3, "psi", { final_score: 0.7, source_type: "psi" } as Partial<Hit>),
      hit(4, "paper", { final_score: 0.6 }),
      hit(5, "paper", { final_score: 0.5 }),
      hit(6, "paper", { final_score: 0.4 }),
    ];
    const out = capPsiShare(ranked, 4);
    expect(out.filter((h) => (h as any).source_type === "psi").length).toBe(2);
  });

  test("does not mutate the input order", () => {
    const ranked = [
      hit(1, "a", { final_score: 0.2 }),
      hit(2, "b", { final_score: 0.9 }),
    ];
    capPsiShare(ranked, 2);
    expect(ranked[0].chunk_id).toBe(1);
  });
});

describe("mmrDiversify", () => {
  test("keeps a diverse passage and drops near-duplicates", () => {
    const q = "flame spread";
    const dupes = [1, 2, 3, 4].map((i) => hit(i, "flame spread in microgravity over solid fuel", { fused_score: 0.03 }));
    // Equally relevant to the query, but about a different subtopic.
    const distinct = hit(9, "flame spread and the soot aerosol particle size distribution", { fused_score: 0.03 });
    const out = mmrDiversify(smartRank(rerank(q, [...dupes, distinct]), q), 3);
    expect(out.length).toBe(3);
    expect(out.some((h) => h.chunk_id === 9)).toBe(true);
  });
});

describe("synonym expansion", () => {
  test("adds domain synonyms to the query tokens", () => {
    const expanded = expandTokens(queryTokens("smolder extinction"));
    expect(expanded).toContain(stem("smolder"));
    expect(expanded).toContain(stem("smoulder"));
    expect(expanded).toContain(stem("quench"));
  });

  test("a synonym match still counts as coverage, but at half an exact hit", () => {
    const q = "extinction limit";
    const exact = hit(1, "the extinction limit was reached");
    const synonym = hit(2, "the quenching limit was reached");
    rerank(q, [exact, synonym]);
    expect(exact.rerank_score).toBeGreaterThan(synonym.rerank_score);
    expect(synonym.rerank_score).toBeGreaterThan(0);
  });
});

describe("relevance gate", () => {
  test("drops a passage that shares none of the query's words", () => {
    const q = "soot volume fraction";
    const onTopic = hit(1, "The soot volume fraction was measured.");
    const offTopic = hit(2, "A study of medieval poetry and its meter.");
    const kept = relevanceGate([onTopic, offTopic], q);
    expect(kept.map((h) => h.chunk_id)).toEqual([1]);
  });

  test("keeps a short query's single-word match", () => {
    const kept = relevanceGate([hit(1, "soot everywhere")], "soot");
    expect(kept.length).toBe(1);
  });

  test("drops a two-word query's single-word false positive", () => {
    // "cooking pasta" tokenises to two content words; a passage that only says
    // "cook" is not an answer to it.
    const q = "cooking pasta";
    const misleading = hit(1, "the cook stirred the pot and served dinner");
    expect(relevanceGate([misleading], q).length).toBe(0);
  });

  test("keeps a synonym match at full credit in the gate", () => {
    // The passage answers with "quenching" where the researcher wrote
    // "extinction"; that is on topic and must survive the gate.
    const kept = relevanceGate([hit(1, "flame quenching limits were reported")], "extinction limit");
    expect(kept.length).toBe(1);
  });

  test("skips the gate for a query with no usable tokens", () => {
    const hits = [hit(1, "anything")];
    expect(relevanceGate(hits, "!!!")).toBe(hits);
  });
});

describe("heuristicGrade", () => {
  test("refuses to grade a match that shares no query words as sufficient", () => {
    // High rerank (dense domain vocabulary) but zero exact overlap with the
    // question: the classic off-topic false positive.
    const q = "cooking pasta";
    const misleading = hit(1, "combustion of soot in microgravity flames", { fused_score: 0.032 });
    smartRank(rerank(q, [misleading]), q);
    const g = heuristicGrade([misleading]);
    expect(g.verdict).toBe("insufficient");
  });

  test("grades a genuine lexical match as sufficient", () => {
    const q = "flame spread rate microgravity";
    const good = hit(1, "the flame spread rate in microgravity was measured and reported", { fused_score: 0.032 });
    smartRank(rerank(q, [good]), q);
    expect(heuristicGrade([good]).verdict).toBe("sufficient");
  });
});

describe("hit explanation", () => {
  test("names the query words a passage matched", () => {
    const q = "soot volume fraction";
    const h = hit(1, "The soot volume fraction grew with pressure.", { fused_score: 0.03 });
    smartRank([h], q);
    expect(h.why).toMatch(/soot/);
  });
});
