import { useEffect, useState } from "react";

import { fmt } from "../lib/format";

interface CountProps {
  value: unknown;
  /** Format the animated value (defaults to `fmt`). */
  format?: (n: number) => string;
  duration?: number;
}

/** Counts a number up once on mount; shows the final value immediately when
 *  motion is reduced or the value is not numeric. */
export function Count({ value, format = fmt, duration = 900 }: CountProps) {
  const target = Number(value);
  const finite = Number.isFinite(target);
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(Number(value))) return;
    const to = Number(value);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(to);
      return;
    }
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt) / duration);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  if (!finite) return <>{fmt(value)}</>;
  return <>{n === null ? format(0) : format(n)}</>;
}
