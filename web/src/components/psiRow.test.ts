import { describe, expect, it } from "vitest";

import { renderPsiRow } from "../../../workers/lava-agent/src/psiRow";

// Mirrors how the loader persists a BASS-II table: `columns` is a list of
// { name, type } objects and each row's `data` is keyed by the published names.
const COLUMNS = [
  { name: "PI", type: "text" },
  { name: "Test #", type: "text" },
  { name: "Final CO (ppm)", type: "number" },
];

const row = {
  test_id: "B1",
  test_date: "2/19/2014",
  data: { PI: "Bhattacharjee", "Test #": "B1", "Final CO (ppm)": 12.5, __index: 0 },
};

describe("renderPsiRow", () => {
  it("reads the column name out of the {name,type} objects", () => {
    const out = renderPsiRow(row, COLUMNS);
    expect(out).toContain("PI: Bhattacharjee");
    expect(out).toContain("Final CO (ppm): 12.5");
    expect(out).not.toContain("(no values)");
    expect(out).not.toContain("[object Object]");
  });

  it("uses the published column order", () => {
    expect(renderPsiRow(row, COLUMNS)).toBe(
      "(test B1, 2/19/2014) PI: Bhattacharjee · Test #: B1 · Final CO (ppm): 12.5",
    );
  });

  it("still accepts a bare string column list", () => {
    expect(renderPsiRow(row, ["PI"])).toContain("PI: Bhattacharjee");
  });

  it("falls back to the row keys when no columns are declared", () => {
    const out = renderPsiRow(row, null);
    expect(out).toContain("PI: Bhattacharjee");
  });

  it("never emits the loader's bookkeeping keys", () => {
    expect(renderPsiRow({ data: { PI: "X", __index: 0 } }, null)).not.toContain("__index");
  });

  it("marks a row with no values rather than rendering empty content", () => {
    expect(renderPsiRow({ data: {} }, COLUMNS)).toBe("(no values)");
  });
});
