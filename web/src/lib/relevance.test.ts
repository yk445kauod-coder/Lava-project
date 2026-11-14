import { describe, expect, it } from "vitest";

import {
  bestEnvironmentFor,
  ENVIRONMENTS,
  EXPERIMENTS,
  fitFor,
  NAMED_ABSENT,
  NAMED_IN_PSI,
  type Need,
  rankAll,
} from "./relevance";

const byKey = (key: string) => EXPERIMENTS.find((e) => e.code === key)!;
const env = (key: string) => ENVIRONMENTS.find((e) => e.key === key)!;

describe("environment rubrics", () => {
  it("has four habitable environments with weights that sum to 1", () => {
    expect(ENVIRONMENTS.map((e) => e.key)).toEqual(["station", "suit", "habitat", "rover"]);
    for (const e of ENVIRONMENTS) {
      const total = Object.values(e.needs).reduce((s, w) => s + (w ?? 0), 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it("marks surface habitats and rovers as partial gravity, station and suit as micro", () => {
    expect(env("station").gravityClass).toBe("micro");
    expect(env("suit").gravityClass).toBe("micro");
    expect(env("habitat").gravityClass).toBe("partial");
    expect(env("rover").gravityClass).toBe("partial");
  });
});

describe("fitFor", () => {
  it("keeps the score inside 0..100", () => {
    for (const e of EXPERIMENTS) {
      for (const en of ENVIRONMENTS) {
        const score = fitFor(en, e).score;
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("matches a solid-fuel suppression investigation to the station", () => {
    // BASS-II studies both solid-fuel flammability and suppression, the two
    // heaviest station needs, so it must rank strong there.
    const fit = fitFor(env("station"), byKey("BASS-II"));
    expect(fit.grade).toBe("strong");
    expect(fit.topNeeds).toContain("material_flammability");
  });

  it("matches the whole-body smoke detector to the station detection need", () => {
    const fit = fitFor(env("station"), byKey("SAME"));
    expect(fit.topNeeds[0]).toBe("detection");
  });

  it("matches the highest-oxygen investigation to high-oxygen environments", () => {
    // CFI ran the highest-O2 gas tests (CFI-G), so it should fit the spacesuit
    // and the 30%+ surface environments better than a plain microgravity issue.
    const cfi = byKey("CFI");
    const suit = fitFor(env("suit"), cfi).score;
    const station = fitFor(env("station"), cfi).score;
    expect(suit).toBeGreaterThan(station);
    expect(fitFor(env("suit"), cfi).topNeeds).toContain("elevated_oxygen");
  });

  it("flags the microgravity-only gap for partial-gravity environments", () => {
    const habitat = fitFor(env("habitat"), byKey("BASS-II"));
    const station = fitFor(env("station"), byKey("BASS-II"));
    expect(habitat.gravityGap).toBe(true);
    expect(station.gravityGap).toBe(false);
    // The caveat must lower the score, never raise it.
    expect(habitat.score).toBeLessThan(station.score);
  });

  it("sorts factors by contribution, descending", () => {
    const fit = fitFor(env("station"), byKey("SAFFIRE"));
    const contributions = fit.factors.map((f) => f.contribution);
    const sorted = [...contributions].sort((a, b) => b - a);
    expect(contributions).toEqual(sorted);
  });
});

describe("rankAll", () => {
  it("returns every environment with all experiments ranked best-first", () => {
    const rankings = rankAll();
    expect(rankings).toHaveLength(ENVIRONMENTS.length);
    for (const r of rankings) {
      expect(r.fits).toHaveLength(EXPERIMENTS.length);
      const scores = r.fits.map((f) => f.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("puts the large-scale growth work on top for the station", () => {
    const station = rankAll().find((r) => r.environment.key === "station")!;
    const leader = station.fits[0].experiment.code;
    expect(["BASS-II", "SAFFIRE", "BASS"]).toContain(leader);
  });
});

describe("bestEnvironmentFor", () => {
  it("routes the whole-body detector experiment and returns a real environment", () => {
    const best = bestEnvironmentFor(byKey("SAME"));
    expect(ENVIRONMENTS.map((e) => e.key)).toContain(best.environment.key);
    expect(best.experiment.code).toBe("SAME");
  });

  it("covers every need used by any environment with a known capability key", () => {
    const needs = new Set<Need>();
    for (const e of ENVIRONMENTS) Object.keys(e.needs).forEach((n) => needs.add(n as Need));
    const capabilityKeys = new Set<Need>();
    for (const e of EXPERIMENTS) Object.keys(e.capabilities).forEach((n) => capabilityKeys.add(n as Need));
    for (const n of needs) expect(capabilityKeys.has(n)).toBe(true);
  });
});

describe("challenge-named investigations", () => {
  it("splits the named investigations into PSI-present and truly-absent, with no overlap", () => {
    const scored = new Set(EXPERIMENTS.map((e) => e.code));
    const inPsi = NAMED_IN_PSI.map((n) => n.code);
    const absent = NAMED_ABSENT.map((n) => n.code);

    // Every challenge-named investigation is accounted for exactly once.
    const named = ["SPICE", "SLICE", "DAFT-2", "BRE", "E-FIELD", "CFI-G", "LUCI", "FM2"];
    expect([...inPsi, ...absent].sort()).toEqual([...named].sort());

    // The two lists must never overlap - a gap claim that is not a gap was the
    // exact defect this split fixes.
    for (const c of inPsi) expect(absent).not.toContain(c);

    for (const n of NAMED_IN_PSI) {
      expect(n.psiId).toMatch(/^PSI-\d+$/);
      expect(n.note.length).toBeGreaterThan(10);
      expect(scored.has(n.code)).toBe(false);
    }
    for (const n of NAMED_ABSENT) {
      expect(n.note.length).toBeGreaterThan(10);
      expect(scored.has(n.code)).toBe(false);
    }
  });
});
