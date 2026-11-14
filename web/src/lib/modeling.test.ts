import { describe, expect, it } from "vitest";

import {
  ENVELOPES,
  MODEL_FAMILIES,
  MODEL_GAPS,
  MODEL_VARIABLES,
  ntrs,
  type ModelSupport,
} from "./modeling";

const SUPPORT: ModelSupport[] = ["bounded", "partial", "gap"];

describe("tested envelopes", () => {
  it("describes every corpus experiment's fuel, geometry and varied conditions", () => {
    expect(ENVELOPES.length).toBeGreaterThanOrEqual(8);
    for (const e of ENVELOPES) {
      expect(e.code.length, `${e.code} code`).toBeGreaterThan(0);
      expect(e.fuel.length, `${e.code} fuel`).toBeGreaterThan(0);
      expect(e.geometry.length, `${e.code} geometry`).toBeGreaterThan(0);
      expect(e.varied.length, `${e.code} varied`).toBeGreaterThan(0);
      expect(["solid", "droplet", "gas"]).toContain(e.form);
    }
  });

  it("keeps investigation codes unique", () => {
    const codes = ENVELOPES.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("separates varied from fixed conditions within each investigation", () => {
    for (const e of ENVELOPES) {
      for (const v of e.varied) {
        expect(e.fixed, `${e.code} lists ${v} as both varied and fixed`).not.toContain(v);
      }
    }
  });
});

describe("model variables", () => {
  it("names a unit and a reason for every variable a model needs", () => {
    expect(MODEL_VARIABLES.length).toBeGreaterThan(0);
    for (const v of MODEL_VARIABLES) {
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.unit.length).toBeGreaterThan(0);
      expect(v.why.length).toBeGreaterThan(0);
    }
  });
});

describe("model families", () => {
  it("gives every family a predictive target, inputs and evidence", () => {
    expect(MODEL_FAMILIES.length).toBeGreaterThan(0);
    for (const m of MODEL_FAMILIES) {
      expect(m.question.length, `${m.key} question`).toBeGreaterThan(0);
      expect(m.target.length, `${m.key} target`).toBeGreaterThan(0);
      expect(m.inputs.length, `${m.key} inputs`).toBeGreaterThan(0);
      expect(m.evidence.length, `${m.key} evidence`).toBeGreaterThan(0);
      expect(SUPPORT).toContain(m.support);
    }
  });

  it("names only investigations that appear in the tested envelopes", () => {
    const known = new Set(ENVELOPES.map((e) => e.code));
    for (const m of MODEL_FAMILIES) {
      for (const ev of m.evidence) {
        expect(known.has(ev.code), `${m.key} cites unknown ${ev.code}`).toBe(true);
      }
    }
  });

  it("requires a citation exactly when the family is bounded by data", () => {
    for (const m of MODEL_FAMILIES) {
      if (m.support === "bounded") {
        expect(m.citations.length, `${m.key} is bounded but cites nothing`).toBeGreaterThan(0);
      }
    }
  });
});

describe("model gaps", () => {
  it("states the limits rather than hiding them", () => {
    expect(MODEL_GAPS.length).toBeGreaterThan(0);
    for (const g of MODEL_GAPS) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("citations", () => {
  it("only uses numeric NTRS source ids that build a real landing URL", () => {
    const all = ENVELOPES.flatMap((e) => e.citations).concat(MODEL_FAMILIES.flatMap((m) => m.citations));
    for (const c of all) {
      expect(c.sourceId, `bad source id ${c.sourceId}`).toMatch(/^\d{6,}$/);
      expect(ntrs(c.sourceId)).toBe(`https://ntrs.nasa.gov/citations/${c.sourceId}`);
    }
  });
});
