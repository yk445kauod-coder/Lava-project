import { useEffect, useRef, type ElementType, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  delay?: number;
  [key: string]: unknown;
}

/** Adds `.in` when the element enters the viewport, matching the legacy
 *  scroll-reveal behaviour (`[data-reveal]` → `.in`). Stays visible when
 *  IntersectionObserver is unavailable or motion is reduced. */
export function Reveal({ children, as: Tag = "div", className = "", delay = 0, ...rest }: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} data-reveal className={className} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>
      {children}
    </Tag>
  );
}
