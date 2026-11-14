import type { Transition, Variants } from "motion/react";

/** Shared motion tokens. Durations match the CSS `--dur-*` scale. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const springSoft: Transition = { type: "spring", stiffness: 260, damping: 26 };
export const easeOut = (dur: number): Transition => ({ duration: dur, ease: EASE_OUT });

/** Enter from below with a fade; the default section/route entrance. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: easeOut(0.32) },
};

/** Parent that staggers its children's entrance. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

/** A short fade/slide for route and panel swaps. */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: easeOut(0.24) },
  exit: { opacity: 0, y: -6, transition: easeOut(0.16) },
};

/** One `whileInView` config so reveals behave the same everywhere. */
export const inView = { once: true, amount: 0.2 } as const;
