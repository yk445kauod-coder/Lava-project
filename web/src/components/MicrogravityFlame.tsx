import "./MicrogravityFlame.css";

import { useEffect, useRef } from "react";

export type FlameState = "earth" | "micro";

interface MicrogravityFlameProps {
  state: FlameState;
  onToggle?: () => void;
  /** Show the built-in toggle button (default true). */
  button?: boolean;
  /** Board width, e.g. "360px" or "100%". */
  width?: string;
  className?: string;
}

/* Animation constants, tuned together with the caption text. Change one only
   alongside the other, or the flame and its caption disagree. */
const A_O = [200, 90, 205, 170, 270, 230, 270, 300, 270, 350, 240, 390, 200, 390, 160, 390, 130, 350, 130, 300, 130, 230, 195, 170, 200, 90];
const B_O = [200, 165, 247, 165, 285, 203, 285, 250, 285, 297, 247, 335, 200, 335, 153, 335, 115, 297, 115, 250, 115, 203, 153, 165, 200, 165];
const A_I = [200, 200, 203, 250, 240, 280, 240, 320, 240, 360, 222, 385, 200, 385, 178, 385, 160, 360, 160, 320, 160, 280, 197, 250, 200, 200];
const B_I = [200, 195, 230, 195, 255, 220, 255, 250, 255, 280, 230, 305, 200, 305, 170, 305, 145, 280, 145, 250, 145, 220, 170, 195, 200, 195];
const COLORS = {
  oA: ["#ff3d00", "#ffb300"],
  oB: ["#1e5bff", "#6fdcff"],
  iA: ["#fff3b0", "#ffd54a"],
  iB: ["#d6f3ff", "#ffffff"],
};
const GLOW = ["#ff6a00", "#2f7bff"] as const;
const DUR = 1900;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const col = (a: string, b: string, k: number) => {
  const x = hex(a);
  const y = hex(b);
  return "rgb(" + x.map((v, i) => Math.round(mix(v, y[i], k))).join(",") + ")";
};
const blend = (a: number[], b: number[], k: number) => a.map((v, i) => mix(v, b[i], k));
const toPath = (p: number[]) =>
  "M" + p[0] + " " + p[1] + "C" + p.slice(2, 8).join(" ") + " " + p.slice(8, 14).join(" ") + " " + p.slice(14, 20).join(" ") + " " + p.slice(20, 26).join(" ") + "Z";

function wobble(p: number[], k: number, ms: number, reduce: boolean): number[] {
  const q = p.slice();
  const s = ms / 1000;
  const f = reduce ? 0 : 1 - k;
  const dx = f * (Math.sin(s * 7.3) * 7 + Math.sin(s * 11.1) * 4);
  const dy = f * (Math.sin(s * 9.2) * 10 + Math.sin(s * 5.1) * 6);
  q[0] += dx; q[24] += dx; q[1] += dy; q[25] += dy; q[2] += dx * 0.6; q[22] += dx * 0.4;
  if (k > 0 && !reduce) {
    const br = 1 + k * Math.sin(s * 2.2) * 0.03;
    for (let i = 0; i < 26; i += 2) {
      q[i] = 200 + (q[i] - 200) * br;
      q[i + 1] = 250 + (q[i + 1] - 250) * br;
    }
  }
  return q;
}

/**
 * Earth flame <-> microgravity flame. The two shapes share the same control
 * points, so we can interpolate between them instead of cross-fading.
 *
 * The animation runs only while the flame is on screen and the tab is visible;
 * under `prefers-reduced-motion` it renders the static end state.
 */
export function MicrogravityFlame({
  state,
  onToggle,
  button = true,
  width = "360px",
  className = "",
}: MicrogravityFlameProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<SVGPathElement>(null);
  const innerRef = useRef<SVGPathElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const candleRef = useRef<SVGGElement>(null);
  const sparksRef = useRef<SVGGElement>(null);
  const stopsRef = useRef<(SVGStopElement | null)[]>([]);

  const uid = useRef("mgf" + Math.random().toString(36).slice(2, 9));
  const tRef = useRef(0);
  const fromRef = useRef(0);
  const toRef = useRef(0);
  const startRef = useRef(0);
  const runRef = useRef(false);
  const visibleRef = useRef(false);
  const rafRef = useRef(0);

  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Build the spark dots once.
  useEffect(() => {
    const g = sparksRef.current;
    if (!g || g.childNodes.length) return;
    for (let i = 0; i < 7; i++) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", String(1.6 + (i % 3) * 0.7));
      c.setAttribute("fill", "#ffd27a");
      g.appendChild(c);
    }
  }, []);

  // Pause the loop when off screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      visibleRef.current = entries.some((e) => e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Start (or retarget) the morph when the state prop changes.
  useEffect(() => {
    const target = state === "micro" ? 1 : 0;
    fromRef.current = tRef.current;
    toRef.current = target;
    startRef.current = performance.now();
    runRef.current = true;
    if (reduce) {
      tRef.current = target;
      runRef.current = false;
    }
  }, [state, reduce]);

  // The animation loop.
  useEffect(() => {
    const render = (ms: number) => {
      const k = ease(tRef.current);
      const o = wobble(blend(A_O, B_O, k), k, ms, reduce);
      const n = wobble(blend(A_I, B_I, k), k, ms + 400, reduce);
      outerRef.current?.setAttribute("d", toPath(o));
      innerRef.current?.setAttribute("d", toPath(n));
      glowRef.current?.setAttribute("d", toPath(o));
      const [s0, s1, s2, s3] = stopsRef.current;
      s0?.setAttribute("stop-color", col(COLORS.oA[0], COLORS.oB[0], k));
      s1?.setAttribute("stop-color", col(COLORS.oA[1], COLORS.oB[1], k));
      s2?.setAttribute("stop-color", col(COLORS.iA[0], COLORS.iB[0], k));
      s3?.setAttribute("stop-color", col(COLORS.iA[1], COLORS.iB[1], k));
      glowRef.current?.setAttribute("fill", col(GLOW[0], GLOW[1], k));
      if (candleRef.current) {
        candleRef.current.style.opacity = String(1 - k);
        candleRef.current.setAttribute("transform", `translate(0 ${k * 40})`);
      }
      const s = ms / 1000;
      const dots = sparksRef.current?.childNodes;
      if (dots) {
        for (let i = 0; i < dots.length; i++) {
          const c = dots[i] as SVGCircleElement;
          const f = reduce ? 0 : (s * 0.32 + i / dots.length) % 1;
          c.setAttribute("cx", String(200 + Math.sin(s * 2 + i * 2.1) * (14 + f * 30) + (i % 2 ? 8 : -8)));
          c.setAttribute("cy", String(300 - f * 230));
          c.setAttribute("opacity", String((1 - f) * (1 - k) * (reduce ? 0 : 0.9)));
        }
      }
    };

    const frame = (ms: number) => {
      if (runRef.current && visibleRef.current && !document.hidden) {
        const p = Math.min((ms - startRef.current) / DUR, 1);
        tRef.current = mix(fromRef.current, toRef.current, p);
        if (p >= 1) runRef.current = false;
      }
      render(ms);
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [reduce]);

  return (
    <div ref={rootRef} className={`mgf ${className}`} data-state={state} style={{ ["--mgf-w" as string]: width }}>
      <svg viewBox="0 0 400 500" role="img" aria-label="Flame">
        <defs>
          <linearGradient id={`${uid.current}O`} x1="0" y1="0" x2="0" y2="1">
            <stop ref={(el) => { stopsRef.current[0] = el; }} offset="0" />
            <stop ref={(el) => { stopsRef.current[1] = el; }} offset="1" />
          </linearGradient>
          <linearGradient id={`${uid.current}I`} x1="0" y1="0" x2="0" y2="1">
            <stop ref={(el) => { stopsRef.current[2] = el; }} offset="0" />
            <stop ref={(el) => { stopsRef.current[3] = el; }} offset="1" />
          </linearGradient>
          <filter id={`${uid.current}B`} x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="26" />
          </filter>
          <filter id={`${uid.current}S`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
        <path ref={glowRef} className="glow" opacity=".6" filter={`url(#${uid.current}B)`} />
        <g ref={candleRef} className="candle">
          <rect x="172" y="392" width="56" height="80" rx="6" fill="#d9d2c0" />
          <rect x="172" y="392" width="56" height="9" rx="4" fill="#efe9d8" />
          <path d="M200 392V376" stroke="#2a2118" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g ref={sparksRef} className="sparks" />
        <path ref={outerRef} className="outer" fill={`url(#${uid.current}O)`} filter={`url(#${uid.current}S)`} />
        <path ref={innerRef} className="inner" fill={`url(#${uid.current}I)`} filter={`url(#${uid.current}S)`} />
      </svg>
      {button && (
        <button
          className="mgf-btn"
          type="button"
          aria-pressed={state === "micro"}
          aria-label="Toggle microgravity"
          onClick={onToggle}
        >
          <svg className="mgf-ic-a" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z" />
          </svg>
          <svg className="mgf-ic-b" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  );
}
