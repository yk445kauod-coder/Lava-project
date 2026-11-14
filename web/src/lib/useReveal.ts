import { useEffect, type RefObject } from "react";

/** Adds `.in` to `.reveal` elements inside `scope` as they scroll into view,
 *  matching the legacy console `reveal()` helper. A MutationObserver picks up
 *  panels that render later (e.g. after a chart loads). No-ops under
 *  reduced-motion, where the CSS already shows the element. */
export function useScrollReveal(scope: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      root.querySelectorAll(".reveal").forEach((n) => n.classList.add("in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.04 },
    );

    const observe = () => root.querySelectorAll(".reveal:not(.in)").forEach((n) => io.observe(n));
    observe();

    const mo = new MutationObserver(observe);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [scope]);
}
