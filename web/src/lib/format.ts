/** Number from a value that may be a string (Neon returns bigint/numeric as
 *  strings), or `null` when it is missing or non-numeric. `null` means
 *  "not reported"; it is never coerced to zero. */
export function num(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const v = Number(n);
  return Number.isNaN(v) ? null : v;
}

/** Grouped integer/decimal for display, or a plain hyphen when missing. */
export function fmt(n: unknown): string {
  const v = num(n);
  return v === null ? "-" : v.toLocaleString("en-US");
}

/** A 0..1 fraction as a whole percent, or a plain hyphen when missing. */
export function pct(x: unknown): string {
  const v = num(x);
  return v === null ? "-" : Math.round(v * 100) + "%";
}

/** Truncate to `n` characters with three dots. */
export function clamp(s: unknown, n: number): string {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) + "..." : str;
}

/** Escape the three characters that break HTML text/attribute context. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Record kinds arrive as slugs ("workshop_proceedings"); show them as words. */
const KIND_LABELS: Record<string, string> = {
  workshop_proceedings: "Workshop proceedings",
  presentation: "Presentation",
  dataset: "Dataset",
  other: "Other",
  document: "Document",
  body: "Body text",
  psi: "PSI table",
};
export function kindLabel(kind: unknown): string {
  const k = String(kind ?? "").trim();
  if (!k) return "";
  return KIND_LABELS[k] || k.replace(/_/g, " ");
}

/** Insight categories are slugs too ("atm_composition"); show them as words. */
const CATEGORY_LABELS: Record<string, string> = {
  atm_composition: "Atmosphere composition",
  ops_risk: "Operations risk",
  suppression: "Suppression",
  material_flammability: "Material flammability",
  detection: "Detection",
};
export function categoryLabel(cat: unknown): string {
  const c = String(cat ?? "").trim();
  if (!c) return "";
  return CATEGORY_LABELS[c] || c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
