/** Dependency-free SVG chart engine, ported from the legacy `charts.js`.
 *  Builders return SVG strings; colours come from CSS custom properties so a
 *  chart follows whichever theme the page is in. */
import { esc, num } from "./format";

const fmtNum = (v: unknown): string => {
  const n = num(v);
  if (n === null) return "-";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 100) return n.toFixed(0);
  if (a >= 10) return trimZero(n.toFixed(1));
  if (a >= 1) return trimZero(n.toFixed(2));
  return n.toPrecision(2);
};

const trimZero = (s: string): string => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

const PALETTE = [
  "var(--c1,#2E6FA8)",
  "var(--c2,#C4531A)",
  "var(--c3,#1E9E6B)",
  "var(--c4,#7A5AF8)",
  "var(--c5,#B58900)",
  "var(--c6,#D94F8A)",
];
const color = (i: number) => PALETTE[i % PALETTE.length];

/** Human-friendly axis steps (1/2/2.5/5/10 × 10ⁿ). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const step0 = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out.length > 1 ? out : [lo, hi];
}

const frame = (inner: string, w: number, h: number, label: string) =>
  `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

function xLabels(labels: string[], X: (i: number) => number, y: number, rotate = false): string {
  return labels
    .map((l, i) =>
      rotate
        ? `<text class="lv-tick" x="${X(i).toFixed(1)}" y="${y}" text-anchor="end" transform="rotate(-38 ${X(i).toFixed(1)} ${y})">${esc(l)}</text>`
        : `<text class="lv-tick" x="${X(i).toFixed(1)}" y="${y}" text-anchor="middle">${esc(l)}</text>`,
    )
    .join("");
}

export interface LineOpts {
  points?: { x: string | number; y: unknown }[];
  xLabel?: string;
  yLabel?: string;
  area?: boolean;
  color?: string;
  label?: string;
  yTicks?: number;
}

export function line({ points = [], xLabel = "", yLabel = "", area = true, color: col, label = "Line chart", yTicks = 4 }: LineOpts): string {
  const W = 760, H = 300, PAD = { l: 64, r: 24, t: 22, b: 50 };
  const pts = points.map((p) => ({ x: p.x, y: num(p.y) })).filter((p) => p.y !== null) as { x: string | number; y: number }[];
  if (!pts.length) return frame(`<text class="lv-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No data</text>`, W, H, label);

  const vals = pts.map((p) => p.y);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals), yTicks);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const X = (i: number) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const Y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const c = col || color(0);

  const grid = ticks
    .map(
      (t) =>
        `<line class="lv-grid" x1="${PAD.l}" y1="${Y(t).toFixed(1)}" x2="${W - PAD.r}" y2="${Y(t).toFixed(1)}"/>` +
        `<text class="lv-tick" x="${PAD.l - 10}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${fmtNum(t)}</text>`,
    )
    .join("");

  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const areaPath = `${d} L${X(pts.length - 1).toFixed(1)},${(PAD.t + ih).toFixed(1)} L${X(0).toFixed(1)},${(PAD.t + ih).toFixed(1)} Z`;
  const dots = pts
    .map(
      (p, i) =>
        `<circle class="lv-dot" cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3.4" fill="${c}"><title>${esc(String(p.x))}: ${fmtNum(p.y)}</title></circle>`,
    )
    .join("");
  const labels = xLabels(pts.map((p) => String(p.x)), X, H - PAD.b + 20, pts.length > 9);
  const yName = yLabel
    ? `<text class="lv-axis" x="${PAD.l - 46}" y="${PAD.t + ih / 2}" text-anchor="middle" transform="rotate(-90 ${PAD.l - 46} ${PAD.t + ih / 2})">${esc(yLabel)}</text>`
    : "";
  const xName = xLabel ? `<text class="lv-axis" x="${PAD.l + iw / 2}" y="${H - 6}" text-anchor="middle">${esc(xLabel)}</text>` : "";

  const inner = `${grid}${yName}${area ? `<path class="lv-area" d="${areaPath}" fill="${c}" fill-opacity=".12"/>` : ""}<path class="lv-line" d="${d}" fill="none" stroke="${c}" pathLength="1"/>${dots}${labels}${xName}`;
  return frame(inner, W, H, label);
}

export interface BarsOpts {
  points?: { x: string | number; y: unknown }[];
  xLabel?: string;
  yLabel?: string;
  label?: string;
  color?: string;
  unit?: string;
}

export function bars({ points = [], xLabel = "", yLabel = "", label = "Bar chart", color: col, unit = "" }: BarsOpts): string {
  const W = 760, H = 320, PAD = { l: 64, r: 24, t: 22, b: 62 };
  const pts = points.map((p) => ({ x: String(p.x), y: num(p.y) })).filter((p) => p.y !== null) as { x: string; y: number }[];
  if (!pts.length) return frame(`<text class="lv-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No data</text>`, W, H, label);

  const vals = pts.map((p) => p.y);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals), 4);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const bw = iw / pts.length;
  const bar = Math.min(46, bw * 0.62);
  const X = (i: number) => PAD.l + bw * i + bw / 2;
  const Y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const base = Y(Math.max(lo, 0));
  const c = col || color(0);

  const grid = ticks
    .map(
      (t) =>
        `<line class="lv-grid" x1="${PAD.l}" y1="${Y(t).toFixed(1)}" x2="${W - PAD.r}" y2="${Y(t).toFixed(1)}"/>` +
        `<text class="lv-tick" x="${PAD.l - 10}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${fmtNum(t)}</text>`,
    )
    .join("");

  const rects = pts
    .map((p, i) => {
      const y = Y(p.y);
      const h = Math.abs(base - y);
      return `<rect class="lv-bar" x="${(X(i) - bar / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="5" fill="${c}" style="--i:${i}"><title>${esc(p.x)}: ${fmtNum(p.y)}${unit ? " " + esc(unit) : ""}</title></rect>`;
    })
    .join("");

  const labels = xLabels(pts.map((p) => p.x), X, H - PAD.b + 20, pts.length > 7);
  const yName = yLabel
    ? `<text class="lv-axis" x="${PAD.l - 46}" y="${PAD.t + ih / 2}" text-anchor="middle" transform="rotate(-90 ${PAD.l - 46} ${PAD.t + ih / 2})">${esc(yLabel)}</text>`
    : "";
  const xName = xLabel ? `<text class="lv-axis" x="${PAD.l + iw / 2}" y="${H - 6}" text-anchor="middle">${esc(xLabel)}</text>` : "";
  const inner = `${grid}${yName}<line class="lv-base" x1="${PAD.l}" y1="${base.toFixed(1)}" x2="${W - PAD.r}" y2="${base.toFixed(1)}"/>${rects}${labels}${xName}`;
  return frame(inner, W, H, label);
}

export interface DonutOpts {
  slices?: { label: string; value: unknown }[];
  label?: string;
  size?: number;
  thickness?: number;
  center?: string;
  centerSub?: string;
}

export function donut({ slices = [], label = "Donut chart", size = 240, thickness = 26, center = "", centerSub = "" }: DonutOpts): string {
  const s = slices.map((x) => ({ label: String(x.label), value: num(x.value) || 0 })).filter((x) => x.value > 0);
  const total = s.reduce((a, x) => a + x.value, 0) || 1;
  const r = (size - thickness) / 2, c = size / 2, circ = 2 * Math.PI * r;
  let acc = 0;
  const arcs = s
    .map((x, i) => {
      const frac = x.value / total;
      const dash = frac * circ;
      const off = -acc * circ;
      acc += frac;
      return `<circle class="lv-arc" cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${color(i)}" stroke-width="${thickness}" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${c} ${c})" style="--i:${i}"><title>${esc(x.label)}: ${fmtNum(x.value)} (${Math.round(frac * 100)}%)</title></circle>`;
    })
    .join("");
  const legend = `<div class="lv-legend">${s
    .map((x, i) => `<span class="lv-key"><i style="background:${color(i)}"></i>${esc(x.label)}<b class="mono2">${fmtNum(x.value)}</b></span>`)
    .join("")}</div>`;
  const mid = center || fmtNum(total);
  const svg = frame(
    `<circle class="lv-ring" cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="var(--border)" stroke-width="${thickness}"/>${arcs}<text class="lv-center" x="${c}" y="${c - 2}" text-anchor="middle">${esc(mid)}</text><text class="lv-center-sub" x="${c}" y="${c + 18}" text-anchor="middle">${esc(centerSub)}</text>`,
    size,
    size,
    label,
  );
  return `<div class="lv-donut">${svg}${legend}</div>`;
}

export interface BarItem {
  label: string;
  value: unknown;
  sub?: string;
  color?: string;
}

/** Ranked horizontal bars as HTML - long labels stay readable and wrap. */
export function barList(items: BarItem[] = [], { unit = "", max }: { unit?: string; max?: number } = {}): string {
  const top = max || Math.max(1, ...items.map((i) => num(i.value) || 0));
  return `<div class="bar-list">${items
    .map(
      (it) => `<div class="bar-item"><div class="bar-top"><span class="bar-name" title="${esc(it.label)}">${esc(it.label)}</span><span class="bar-val mono2">${fmtNum(it.value)}${unit ? " " + esc(unit) : ""}</span></div><div class="bar-track"><i style="width:${Math.max(2, ((num(it.value) || 0) / top) * 100).toFixed(1)}%${it.color ? `;background:${it.color}` : ""}"></i></div>${it.sub ? `<div class="bar-sub">${esc(it.sub)}</div>` : ""}</div>`,
    )
    .join("")}</div>`;
}

export const chart = { line, bars, donut, barList, fmtNum, niceTicks, palette: PALETTE, color };
