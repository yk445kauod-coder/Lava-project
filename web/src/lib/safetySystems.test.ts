import { describe, expect, it } from "vitest";

import {
  allCitations,
  EARTH_APPLICATIONS,
  HARDWARE_GROUPS,
  investigationHref,
  mappedInvestigations,
  ntrs,
  PILLARS,
  SENSORS,
} from "./safetySystems";

describe("fire-safety strategies", () => {
  it("covers exactly prevention, detection and suppression", () => {
    expect(PILLARS.map((p) => p.key)).toEqual(["prevention", "detection", "suppression"]);
  });

  it("gives every strategy corpus evidence, a next-generation target and citations", () => {
    for (const p of PILLARS) {
      expect(p.what.length, `${p.key} what`).toBeGreaterThan(0);
      expect(p.corpus.length, `${p.key} corpus`).toBeGreaterThan(0);
      expect(p.informs.length, `${p.key} informs`).toBeGreaterThan(0);
      expect(p.investigations.length, `${p.key} investigations`).toBeGreaterThan(0);
      expect(p.citations.length, `${p.key} citations`).toBeGreaterThan(0);
    }
  });
});

describe("citations", () => {
  it("only uses numeric NTRS source ids and builds a real landing URL", () => {
    for (const c of allCitations()) {
      expect(c.sourceId, `bad source id ${c.sourceId}`).toMatch(/^\d{6,}$/);
      expect(c.title.length).toBeGreaterThan(0);
      expect(ntrs(c.sourceId)).toBe(`https://ntrs.nasa.gov/citations/${c.sourceId}`);
    }
  });

  it("de-duplicates citations by source id", () => {
    const ids = allCitations().map((c) => c.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("hardware groups", () => {
  it("assigns every investigation a PSI id that looks like a PSI reference", () => {
    for (const g of HARDWARE_GROUPS) {
      expect(g.investigations.length).toBeGreaterThan(0);
      for (const inv of g.investigations) {
        expect(inv.code.length).toBeGreaterThan(0);
        expect(inv.note.length).toBeGreaterThan(0);
        if (inv.psiId) expect(inv.psiId).toMatch(/^PSI-\d+$/);
      }
    }
  });

  it("keeps each investigation code unique across the hardware sets", () => {
    const codes = HARDWARE_GROUPS.flatMap((g) => g.investigations.map((i) => i.code));
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("sensors", () => {
  it("names a measurement, an instrument class and at least one campaign", () => {
    for (const s of SENSORS) {
      expect(s.measurement.length).toBeGreaterThan(0);
      expect(s.instruments.length).toBeGreaterThan(0);
      expect(s.campaigns.length).toBeGreaterThan(0);
    }
  });
});

describe("Earth applications", () => {
  it("tags every application as brief- or corpus-sourced", () => {
    for (const a of EARTH_APPLICATIONS) {
      expect(["brief", "corpus"]).toContain(a.source);
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.detail.length).toBeGreaterThan(0);
    }
  });

  it("requires a citation exactly when the claim is corpus-sourced", () => {
    for (const a of EARTH_APPLICATIONS) {
      if (a.source === "corpus") {
        expect(a.citation, `${a.title} claims corpus but has no citation`).toBeTruthy();
      }
    }
  });
});

describe("mappedInvestigations", () => {
  it("de-duplicates the investigation codes named across the strategies", () => {
    const mapped = mappedInvestigations();
    expect(mapped.length).toBeGreaterThan(0);
    expect(new Set(mapped).size).toBe(mapped.length);
  });
});

describe("investigationHref", () => {
  it("sends a corpus experiment to its console page", () => {
    const h = investigationHref({ code: "BASS-II" });
    expect(h.external).toBe(false);
    expect(h.to).toBe("/experiments?code=BASS-II");
  });

  it("sends a PSI-only investigation to psi.nasa.gov", () => {
    const h = investigationHref({ code: "SPICE", psiId: "PSI-107" });
    expect(h.external).toBe(true);
    expect(h.to).toBe("https://psi.nasa.gov/physci/repo/data/investigations/PSI-107");
  });

  it("gives every pillar investigation a resolvable target", () => {
    for (const p of PILLARS) {
      for (const inv of p.investigations) {
        const h = investigationHref(inv);
        expect(h.to.length, `${p.key}/${inv.code}`).toBeGreaterThan(0);
      }
    }
  });
});
