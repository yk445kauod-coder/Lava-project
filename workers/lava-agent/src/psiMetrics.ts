/**
 * Derive headline measurement counts from a PSI investigation's published
 * tables.
 *
 * An experiment page reads two independent evidence sources: values mined from
 * NTRS report text, and the spreadsheets NASA publishes in PSI. Some
 * experiments (CFI, SPICE, SLICE) have no mined findings but plenty of PSI rows,
 * so counting only the mined side reports "0 measurements" directly above a
 * table of measured values. This module maps the PSI column names onto the
 * dashboard's metric vocabulary so the two sources can be shown together.
 *
 * The counts are honest: a column only contributes when a row carries a numeric
 * value under it, so a column of blanks or "-" adds nothing.
 */

export interface PsiMetric {
  metric: string;
  n: number;
}

interface Rule {
  /** Matched against the published column name, lowercased. */
  test: RegExp;
  metric: string;
}

/* Ordered: the first matching rule wins, so the more specific patterns come
 * before the generic ones ("pressure" before "rate", "o2" before "o"). */
const RULES: Rule[] = [
  { test: /oxygen|^o2\b|xo2|o2 flow/, metric: "oxygen concentration" },
  { test: /pressure|pinit|pfinal|pmean|approx p\b/, metric: "pressure" },
  { test: /droplet.*diameter|initial diameter/, metric: "droplet diameter" },
  { test: /burn time|duration|burn time \(sec\)/, metric: "burn time" },
  { test: /inlet velocity|air rate|flow rate|flow velocity/, metric: "flow velocity" },
  { test: /tad|flame temp|burner temp|temperature/, metric: "flame temperature" },
  { test: /soot|smoke.*size|particle size/, metric: "soot / particle size" },
  { test: /fuel rate|mhc|mo2|mn2|mtot/, metric: "fuel / gas flow rate" },
  { test: /gravity|g level|g-level/, metric: "gravity level" },
];

/** PSI cells are strings like "1 atm", "0.21", "No", "02:03:08 pm est". Only a
 *  cell that parses as a finite number counts as a measurement. */
function numeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s === "-") return false;
  // Accept a leading number ("1 atm", "0.21", "1.25 atm") but reject times and
  // dates, which also start with digits.
  const m = s.match(/^-?\d+(\.\d+)?([eE][-+]?\d+)?\b/);
  if (!m) return false;
  if (/\d:\d/.test(s) || /[A-Za-z]{3}-?\d{2}\b/.test(s)) return false;
  return Number.isFinite(Number(m[0]));
}

function ruleFor(column: string): Rule | null {
  const c = column.toLowerCase();
  return RULES.find((r) => r.test.test(c)) ?? null;
}

export function derivePsiMetrics(
  tables: { columns?: unknown; rows?: Record<string, unknown>[] }[],
): { total: number; metrics: PsiMetric[] } {
  const byMetric = new Map<string, number>();

  for (const table of tables ?? []) {
    const columns = Array.isArray(table.columns)
      ? table.columns
          .map((c) => (typeof c === "string" ? c : c && typeof c === "object" ? (c as any).name : null))
          .filter((n): n is string => typeof n === "string" && n.length > 0)
      : [];
    // Fall back to the row keys when the table ships no column list.
    const cols = columns.length ? columns : Object.keys(table.rows?.[0] ?? {});
    const matched = cols
      .map((name) => ({ name, rule: ruleFor(name) }))
      .filter((c): c is { name: string; rule: Rule } => Boolean(c.rule));

    for (const row of table.rows ?? []) {
      for (const { name, rule } of matched) {
        const value = row?.[name];
        if (numeric(value)) byMetric.set(rule.metric, (byMetric.get(rule.metric) ?? 0) + 1);
      }
    }
  }

  const metrics = [...byMetric.entries()]
    .map(([metric, n]) => ({ metric, n }))
    .sort((a, b) => b.n - a.n);
  return { total: metrics.reduce((a, m) => a + m.n, 0), metrics };
}
