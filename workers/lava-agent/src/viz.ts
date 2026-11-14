/**
 * Chart engine for reports.
 *
 * One ChartSpec drives three backends so a chart looks the same everywhere:
 *   - SVG  for the dashboard and for inline display in a report
 *   - PNG  for DOCX, which cannot carry our vector output
 *   - PDF  vector operators, so exported charts stay sharp when printed
 *
 * The spec is deliberately narrow (bar / line / scatter with labelled axes).
 * A spec is always built from real `ignis.dataset_row` values by the caller -
 * this module only draws what it is given and never synthesises data points.
 */

import { createCanvas, drawCircle, drawLine, drawText, encodePng, fillRect, textWidth, type Canvas } from "./png";

export type Point = { x: number | string; y: number };

export type ChartSpec = {
  type: "bar" | "line" | "scatter";
  title: string;
  x_label: string;
  y_label: string;
  unit: string;
  series: { label: string; points: Point[] }[];
  /** Provenance line shown under the chart; states where the numbers came from. */
  source_note?: string;
};

const W = 720, H = 330;
const PAD = { l: 68, r: 18, t: 40, b: 62 };

/* Colours for the raster/PDF backends (exports are printed on white). */
const INK = "#25364A";
const MUTED = "#5A6C82";
const GRID = "#D9E2EC";
const BASELINE = "#C2CEE0";
const ACCENT = "#2E6FA8";
const ACCENT2 = "#C4531A";
const ACCENT3 = "#1E9E6B";
const PAPER = "#FFFFFF";

/* The inline SVG reads the page's design tokens so it matches light and dark
   themes instead of drawing a fixed dark panel over a light card. The literal
   fallback is used when the SVG is loaded standalone (data URI). */
const V = {
  paper: "var(--surface,#FFFFFF)",
  ink: "var(--text,#25364A)",
  muted: "var(--muted,#5A6C82)",
  grid: "var(--border,#D9E2EC)",
  baseline: "var(--border,#C2CEE0)",
  a1: "var(--accent-ink,#2E6FA8)",
  a2: "var(--flame-strong,#C4531A)",
  a3: "#1E9E6B",
};
const VCOLORS = [V.a1, V.a2, V.a3];

let uid = 0;

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Round a value to a readable label without implying false precision. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "-";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

type Layout = {
  xs: (i: number) => number;
  ys: (v: number) => number;
  xTicks: { pos: number; label: string }[];
  yTicks: { pos: number; label: string }[];
  yLo: number;
  yHi: number;
  bw: number;
};

function layout(spec: ChartSpec): Layout {
  const pts = spec.series.flatMap((s) => s.points);
  const values = pts.map((p) => p.y).filter((v) => Number.isFinite(v));
  const yLo = Math.min(...values, 0);
  const yHi = Math.max(...values, 1);
  const span = yHi - yLo || 1;

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const categorical = typeof pts[0]?.x === "string";
  const n = categorical
    ? Math.max(...spec.series.map((s) => s.points.length))
    : pts.length;

  const xs = categorical
    ? (i: number) => PAD.l + (plotW / Math.max(n, 1)) * (i + 0.5)
    : (i: number) => PAD.l + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const ys = (v: number) => PAD.t + plotH - ((v - yLo) / span) * plotH;

  const xTicks: { pos: number; label: string }[] = [];
  if (categorical) {
    const labels = spec.series[0]?.points.map((p) => String(p.x)) ?? [];
    labels.forEach((label, i) => xTicks.push({ pos: xs(i), label: label.slice(0, 12) }));
  } else {
    const xs2 = spec.series[0]?.points.map((p) => Number(p.x)) ?? [];
    const step = Math.max(1, Math.ceil(xs2.length / 8));
    xs2.forEach((v, i) => {
      if (i % step === 0) xTicks.push({ pos: xs(i), label: fmt(v) });
    });
  }

  const yTicks: { pos: number; label: string }[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = yLo + (span * i) / 4;
    yTicks.push({ pos: ys(v), label: fmt(v) });
  }

  const bw = categorical ? Math.max(6, (plotW / Math.max(n, 1)) * 0.55) : 0;
  return { xs, ys, xTicks, yTicks, yLo, yHi, bw };
}

// SVG

export function renderSvg(spec: ChartSpec): string {
  const L = layout(spec);
  const parts: string[] = [];
  const id = `lvz${(uid = (uid + 1) % 1e6)}`;

  // Series palette: gradient ids cycle with the series index.
  const stops = [
    ["var(--accent-ink,#2E6FA8)", "#5C93C9"],
    ["var(--flame-strong,#C4531A)", "#F07836"],
    ["#1E9E6B", "#5FC79A"],
  ];
  let defs = "";
  for (let i = 0; i < stops.length; i++) {
    defs +=
      `<linearGradient id="${id}g${i}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${stops[i][1]}" stop-opacity="0.95"/>` +
      `<stop offset="1" stop-color="${stops[i][0]}" stop-opacity="0.78"/></linearGradient>`;
  }
  const seriesFill = (si: number) => `url(#${id}g${si % stops.length})`;
  const seriesLine = (si: number) => stops[si % stops.length][0];

  parts.push(`<defs>${defs}</defs>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="${V.paper}"/>`);
  parts.push(`<text x="${PAD.l}" y="25" fill="${V.ink}" font-size="15" font-family="Manrope, system-ui, sans-serif" font-weight="700">${esc(spec.title)}</text>`);

  // gridlines + y labels
  for (const t of L.yTicks) {
    parts.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${t.pos.toFixed(1)}" y2="${t.pos.toFixed(1)}" stroke="${V.grid}" stroke-width="1" stroke-dasharray="3 4" opacity="0.9"/>`);
    parts.push(`<text x="${PAD.l - 10}" y="${(t.pos + 4).toFixed(1)}" fill="${V.muted}" font-size="10.5" text-anchor="end" font-family="'JetBrains Mono', monospace">${esc(t.label)}</text>`);
  }
  for (const t of L.xTicks) {
    parts.push(`<text x="${t.pos.toFixed(1)}" y="${H - PAD.b + 18}" fill="${V.muted}" font-size="10.5" text-anchor="middle" font-family="'JetBrains Mono', monospace">${esc(t.label)}</text>`);
  }
  parts.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${H - PAD.b}" y2="${H - PAD.b}" stroke="${V.baseline}" stroke-width="1.4"/>`);

  const base = L.ys(L.yLo);
  spec.series.forEach((s, si) => {
    if (spec.type === "bar") {
      s.points.forEach((p, i) => {
        const y = L.ys(p.y);
        const top = Math.min(y, base);
        const h = Math.max(0, Math.abs(base - y));
        const rx = Math.min(L.bw / 2, 6, Math.max(0, h / 2));
        parts.push(
          `<rect class="${id}b" style="animation-delay:${(i * 32).toFixed(0)}ms" x="${(L.xs(i) - L.bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${L.bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx.toFixed(1)}" fill="${seriesFill(si)}"/>`,
        );
      });
    } else if (spec.type === "line") {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${L.xs(i).toFixed(1)},${L.ys(p.y).toFixed(1)}`).join(" ");
      parts.push(`<path class="${id}l" pathLength="1" d="${d}" fill="none" stroke="${seriesLine(si)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
      s.points.forEach((p, i) => parts.push(`<circle cx="${L.xs(i).toFixed(1)}" cy="${L.ys(p.y).toFixed(1)}" r="2.8" fill="${seriesLine(si)}" stroke="${V.paper}" stroke-width="1.2"/>`));
    } else {
      s.points.forEach((p, i) =>
        parts.push(`<circle cx="${L.xs(i).toFixed(1)}" cy="${L.ys(p.y).toFixed(1)}" r="3.4" fill="${seriesLine(si)}" fill-opacity="0.9"/>`),
      );
    }
  });

  const yLabel = spec.unit ? `${spec.y_label} (${spec.unit})` : spec.y_label;
  parts.push(`<text x="16" y="${PAD.t + (H - PAD.t - PAD.b) / 2}" fill="${V.muted}" font-size="10.5" font-family="Manrope, system-ui, sans-serif" transform="rotate(-90 16 ${PAD.t + (H - PAD.t - PAD.b) / 2})" text-anchor="middle">${esc(yLabel)}</text>`);
  parts.push(`<text x="${PAD.l + (W - PAD.l - PAD.r) / 2}" y="${H - 26}" fill="${V.muted}" font-size="10.5" font-family="Manrope, system-ui, sans-serif" text-anchor="middle">${esc(spec.x_label)}</text>`);

  if (spec.series.length > 1) {
    let lx = PAD.l;
    spec.series.forEach((s, si) => {
      parts.push(`<rect x="${lx}" y="${H - 15}" width="9" height="9" rx="2" fill="${seriesFill(si)}"/>`);
      parts.push(`<text x="${lx + 13}" y="${H - 7}" fill="${V.muted}" font-size="10" font-family="Manrope, system-ui, sans-serif">${esc(s.label)}</text>`);
      lx += 22 + textWidth(s.label, 1) * 1.15;
    });
  }
  if (spec.source_note) {
    parts.push(`<text x="${PAD.l}" y="${H - 2}" fill="${V.muted}" font-size="9" font-family="Manrope, system-ui, sans-serif" opacity="0.9">${esc(spec.source_note.slice(0, 120))}</text>`);
  }

  // Motion lives inside the SVG so it also animates when embedded in a report.
  // It is neutralised by the host page's prefers-reduced-motion rule.
  const style =
    `<style>@keyframes ${id}grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}` +
    `.${id}b{transform-box:fill-box;transform-origin:bottom;animation:${id}grow .55s cubic-bezier(.2,.7,.2,1) both}` +
    `@keyframes ${id}draw{to{stroke-dashoffset:0}}` +
    `.${id}l{stroke-dasharray:1;stroke-dashoffset:1;animation:${id}draw 1s cubic-bezier(.4,0,.2,1) .1s both}` +
    `@media (prefers-reduced-motion:reduce){.${id}b,.${id}l{animation:none;transform:none;stroke-dashoffset:0}}</style>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.title)}">${style}${parts.join("")}</svg>`;
}

/** SVG wrapped as a data URI, for embedding in markdown. */
export function svgDataUri(spec: ChartSpec): string {
  const svg = renderSvg(spec);
  // encodeURIComponent keeps this valid in a data URI without a base64 round trip.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// PNG

export async function renderPng(spec: ChartSpec, scale = 2): Promise<Uint8Array> {
  const L = layout(spec);
  const c: Canvas = createCanvas(W * scale, H * scale, rgb(PAPER));

  const px = (v: number) => v * scale;
  const s = (v: number, m: number) => Math.round(v * scale) - m;

  drawText(c, px(PAD.l), px(24) - 12, spec.title.slice(0, 60), rgb(INK), scale);

  for (const t of L.yTicks) {
    drawLine(c, px(PAD.l), px(t.pos), px(W - PAD.r), px(t.pos), rgb(GRID), scale);
    const label = t.label;
    drawText(c, s(PAD.l - 8, textWidth(label, scale)), px(t.pos) - 2 * scale, label, rgb(MUTED), scale);
  }
  for (const t of L.xTicks) {
    drawText(c, s(t.pos, textWidth(t.label, scale) / 2), px(H - PAD.b + 12), t.label, rgb(MUTED), scale);
  }
  drawLine(c, px(PAD.l), px(H - PAD.b), px(W - PAD.r), px(H - PAD.b), rgb(BASELINE), scale);

  const colors = [ACCENT, ACCENT2, ACCENT3];
  spec.series.forEach((ser, si) => {
    const color = rgb(colors[si % colors.length]);
    if (spec.type === "bar") {
      ser.points.forEach((p, i) => {
        const y = L.ys(p.y);
        const base = L.ys(L.yLo);
        fillRect(c, px(L.xs(i) - L.bw / 2), px(Math.min(y, base)), px(L.bw), px(Math.abs(base - y)), color);
      });
    } else if (spec.type === "line") {
      ser.points.forEach((p, i) => {
        if (i === 0) return;
        const prev = ser.points[i - 1];
        drawLine(c, px(L.xs(i - 1)), px(L.ys(prev.y)), px(L.xs(i)), px(L.ys(p.y)), color, Math.max(1, scale));
      });
      ser.points.forEach((p, i) => drawCircle(c, px(L.xs(i)), px(L.ys(p.y)), Math.max(1.5, scale * 1.4), color));
    } else {
      ser.points.forEach((p, i) => drawCircle(c, px(L.xs(i)), px(L.ys(p.y)), Math.max(1.5, scale * 1.6), color));
    }
  });

  const yLabel = (spec.unit ? `${spec.y_label} (${spec.unit})` : spec.y_label).slice(0, 22);
  drawText(c, px(6), px(PAD.t + 10), yLabel, rgb(MUTED), scale);
  const xLabel = spec.x_label.slice(0, 40);
  drawText(c, s(PAD.l + (W - PAD.l - PAD.r) / 2, textWidth(xLabel, scale) / 2), px(H - 30), xLabel, rgb(MUTED), scale);
  if (spec.source_note) {
    drawText(c, px(PAD.l), px(H - 10), spec.source_note.slice(0, 90), rgb(MUTED), Math.max(1, scale - 1));
  }

  return encodePng(c);
}

// PDF

/** PDF content-stream operators for the chart, drawn in a 720x330 user space. */
export function renderPdfOps(spec: ChartSpec): { ops: string; width: number; height: number } {
  const L = layout(spec);
  const ops: string[] = [];
  const fill = (hex: string) => {
    const [r, g, b] = rgb(hex);
    return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`;
  };
  const txt = (x: number, y: number, size: number, hex: string, s: string) =>
    `BT /F1 ${size} Tf ${fill(hex)} rg 1 0 0 1 ${x.toFixed(2)} ${(H - y).toFixed(2)} Tm (${s.replace(/[\\()]/g, "\\$&")}) Tj ET\n`;

  ops.push(`${fill(PAPER)} rg 0 0 ${W} ${H} re f\n`);
  ops.push(txt(PAD.l, 26, 12, INK, spec.title));

  for (const t of L.yTicks) {
    ops.push(`${fill(GRID)} RG 0.5 w ${PAD.l} ${(H - t.pos).toFixed(2)} m ${W - PAD.r} ${(H - t.pos).toFixed(2)} l S\n`);
    ops.push(txt(PAD.l - 8 - t.label.length * 4.6, t.pos + 3, 7.5, MUTED, t.label));
  }
  for (const t of L.xTicks) {
    ops.push(txt(t.pos - t.label.length * 2.3, H - PAD.b + 13, 7.5, MUTED, t.label));
  }
  ops.push(`${fill(BASELINE)} RG 0.6 w ${PAD.l} ${H - PAD.b} m ${W - PAD.r} ${H - PAD.b} l S\n`);

  const colors = [ACCENT, ACCENT2, ACCENT3];
  spec.series.forEach((ser, si) => {
    const hex = colors[si % colors.length];
    if (spec.type === "bar") {
      for (const [i, p] of ser.points.entries()) {
        const y = L.ys(p.y), base = L.ys(L.yLo);
        const top = Math.min(y, base);
        ops.push(`${fill(hex)} rg ${(L.xs(i) - L.bw / 2).toFixed(2)} ${(H - top - Math.abs(base - y)).toFixed(2)} ${L.bw.toFixed(2)} ${Math.abs(base - y).toFixed(2)} re f\n`);
      }
    } else if (spec.type === "line") {
      ops.push(`${fill(hex)} RG 1.2 w\n`);
      ser.points.forEach((p, i) => {
        const x = L.xs(i), y = H - L.ys(p.y);
        ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${i ? "l" : "m"}\n`);
      });
      ops.push("S\n");
      for (const [i, p] of ser.points.entries()) {
        const x = L.xs(i), y = H - L.ys(p.y);
        ops.push(`${fill(hex)} rg ${x.toFixed(2)} ${y.toFixed(2)} 1.8 0 360 arc f\n`);
      }
    } else {
      for (const [i, p] of ser.points.entries()) {
        const x = L.xs(i), y = H - L.ys(p.y);
        ops.push(`${fill(hex)} rg ${x.toFixed(2)} ${y.toFixed(2)} 2 0 360 arc f\n`);
      }
    }
  });

  const yLabel = spec.unit ? `${spec.y_label} (${spec.unit})` : spec.y_label;
  ops.push(txt(PAD.l - 60, 20, 7.5, MUTED, yLabel.slice(0, 20)));
  ops.push(txt(PAD.l + (W - PAD.l - PAD.r) / 2 - spec.x_label.length * 2.3, H - 28, 7.5, MUTED, spec.x_label));
  if (spec.source_note) ops.push(txt(PAD.l, H - 8, 6.5, MUTED, spec.source_note.slice(0, 110)));

  return { ops: ops.join(""), width: W, height: H };
}

export const CHART_SIZE = { width: W, height: H };
