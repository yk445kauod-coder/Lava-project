import { describe, expect, it } from "vitest";

import { categoryLabel, clamp, esc, fmt, kindLabel, num, pct } from "./format";

describe("num", () => {
  it("coerces numeric strings (Neon returns bigint/numeric as strings)", () => {
    expect(num("1234")).toBe(1234);
    expect(num("3.5")).toBe(3.5);
  });
  it("returns null for null, undefined, empty and non-numeric", () => {
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num("")).toBeNull();
    expect(num("n/a")).toBeNull();
  });
  it("keeps zero (null conditions are not zero, but zero is a real value)", () => {
    expect(num(0)).toBe(0);
    expect(num("0")).toBe(0);
  });
});

describe("fmt", () => {
  it("groups thousands", () => {
    expect(fmt(1234567)).toBe("1,234,567");
  });
  it("renders a plain hyphen for missing values", () => {
    expect(fmt(null)).toBe("-");
    expect(fmt("oops")).toBe("-");
  });
});

describe("pct", () => {
  it("rounds a fraction to a whole percent", () => {
    expect(pct(0.923)).toBe("92%");
    expect(pct(1)).toBe("100%");
  });
  it("renders a plain hyphen for missing values", () => {
    expect(pct(null)).toBe("-");
  });
});

describe("clamp", () => {
  it("truncates with three dots past the limit", () => {
    expect(clamp("abcdef", 3)).toBe("abc...");
  });
  it("leaves short strings untouched", () => {
    expect(clamp("ab", 5)).toBe("ab");
  });
});

describe("esc", () => {
  it("escapes the three dangerous characters", () => {
    expect(esc("<a & b>")).toBe("&lt;a &amp; b&gt;");
  });
});

describe("kindLabel", () => {
  it("titles known record-kind slugs", () => {
    expect(kindLabel("workshop_proceedings")).toBe("Workshop proceedings");
    expect(kindLabel("presentation")).toBe("Presentation");
    expect(kindLabel("dataset")).toBe("Dataset");
  });
  it("turns an unknown slug into words", () => {
    expect(kindLabel("technical_report")).toBe("technical report");
  });
  it("returns an empty string for a missing kind", () => {
    expect(kindLabel(null)).toBe("");
    expect(kindLabel("  ")).toBe("");
  });
});

describe("categoryLabel", () => {
  it("titles known insight-category slugs", () => {
    expect(categoryLabel("atm_composition")).toBe("Atmosphere composition");
    expect(categoryLabel("ops_risk")).toBe("Operations risk");
  });
  it("title-cases an unknown slug", () => {
    expect(categoryLabel("cool_flame")).toBe("Cool Flame");
  });
});
