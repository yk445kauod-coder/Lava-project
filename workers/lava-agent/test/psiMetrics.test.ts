/**
 * PSI measurement derivation.
 *
 * The experiment page reports a measurement count, and the bug this guards is
 * an experiment whose NTRS text yields no findings but whose PSI table is full
 * of measured rows: counting only the mined side showed "0 measurements" above
 * a table of values. The derivation must count a column only when a row carries
 * a number under it, and must not mistake a timestamp or a label for a value.
 */
import { describe, expect, test } from "vitest";

import { derivePsiMetrics } from "../src/psiMetrics";

const table = (columns: string[], rows: Record<string, unknown>[]) => ({
  columns: columns.map((name) => ({ name, type: "text" })),
  rows,
});

describe("derivePsiMetrics", () => {
  test("counts numeric cells under a recognised column", () => {
    const out = derivePsiMetrics([
      table(["Pressure", "Oxygen", "Fuel"], [
        { Pressure: "1 atm", Oxygen: "0.21", Fuel: "propane" },
        { Pressure: "0.5 atm", Oxygen: "0.30", Fuel: "propane" },
      ]),
    ]);
    const byMetric = Object.fromEntries(out.metrics.map((m) => [m.metric, m.n]));
    expect(byMetric["pressure"]).toBe(2);
    expect(byMetric["oxygen concentration"]).toBe(2);
    // "propane" is a label, not a measurement.
    expect(out.metrics.some((m) => /fuel \/ gas flow rate/.test(m.metric))).toBe(false);
    expect(out.total).toBe(4);
  });

  test("ignores timestamps, dates and blanks", () => {
    const out = derivePsiMetrics([
      table(["Test GMT", "Date", "Oxygen"], [
        { "Test GMT": "02:03:08 pm est", Date: "2024-05-01", Oxygen: "-" },
        { "Test GMT": "10:15:00", Date: "2024-05-02", Oxygen: "" },
      ]),
    ]);
    // Only the Oxygen column is a measurement column, and every value is blank.
    expect(out.total).toBe(0);
  });

  test("a table with no column list falls back to the row keys", () => {
    const out = derivePsiMetrics([
      { rows: [{ "approx p (bar)": "2", XO2: "0.85" }, { "approx p (bar)": "2", XO2: "0.85" }] },
    ]);
    const byMetric = Object.fromEntries(out.metrics.map((m) => [m.metric, m.n]));
    expect(byMetric["pressure"]).toBe(2);
    expect(byMetric["oxygen concentration"]).toBe(2);
  });

  test("an empty investigation yields nothing, not a zero row", () => {
    expect(derivePsiMetrics([])).toEqual({ total: 0, metrics: [] });
  });
});
