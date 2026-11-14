import type { SVGProps } from "react";

/** Minimal inline icon set (Lucide geometry, ISC). No icon dependency, no CDN
 *  request at runtime. Icons render at 1em and inherit `currentColor`. */
const PATHS: Record<string, string[]> = {
  grid: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"],
  "chevron-left": ["M15 18l-6-6 6-6"],
  comments: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M9 13h6", "M9 17h6"],
  book: ["M4 19.5A2.5 2.5 0 0 1 6.5 17H20", "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"],
  flask: ["M9 3h6", "M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3", "M7.5 14h9"],
  chart: ["M3 3v18h18", "M7 15v-5", "M12 15V8", "M17 15v-3"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  scale: ["M12 3v18", "M7 7l-4 7h8z", "M17 7l-4 7h8z", "M5 7h14"],
  rank: ["M12 2l2.4 5.2 5.6.6-4.2 3.7 1.2 5.5L12 14.4 6.9 17l1.2-5.5L4 7.8l5.6-.6z"],
  compare: ["M8 3v18", "M16 3v18", "M3 7l5-4 5 4", "M13 17l5 4 5-4"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  menu: ["M3 6h18", "M3 12h18", "M3 18h18"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  more: ["M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
  sun: ["M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 1v2", "M12 21v2", "M4.2 4.2l1.4 1.4", "M18.4 18.4l1.4 1.4", "M1 12h2", "M21 12h2", "M4.2 19.8l1.4-1.4", "M18.4 5.6l1.4-1.4"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  globe: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M2 12h20", "M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"],
  plus: ["M12 5v14", "M5 12h14"],
  bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  satellite: ["M13 7l4 4", "M9 11l-4 4 4 4 4-4", "M15 5l4 4", "M5 21l4-4"],
  sparkles: ["M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z", "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  copy: ["M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
  external: ["M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6", "M15 3h6v6", "M10 14L21 3"],
  check: ["M20 6L9 17l-5-5"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01"],
  arrowRight: ["M5 12h14", "M12 5l7 7-7 7"],
  arrowLeft: ["M19 12H5", "M12 19l-7-7 7-7"],
  layers: ["M12 2l9 5-9 5-9-5z", "M3 12l9 5 9-5", "M3 17l9 5 9-5"],
  database: ["M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z", "M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
  activity: ["M22 12h-4l-3 9L9 3l-3 9H2"],
  cpu: ["M4 4h16v16H4z", "M9 9h6v6H9z", "M9 1v3", "M15 1v3", "M9 20v3", "M15 20v3", "M20 9h3", "M20 14h3", "M1 9h3", "M1 14h3"],
  play: ["M6 3l14 9-14 9z"],
  refresh: ["M23 4v6h-6", "M1 20v-6h6", "M3.5 9a9 9 0 0 1 14.9-3.4L23 10", "M1 14l4.6 4.4A9 9 0 0 0 20.5 15"],
  thumbsUp: ["M7 10v12", "M15 5.9L14 10h5.8a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 18.6 22H7V10l4-8a2.4 2.4 0 0 1 2 2v2z"],
  thumbsDown: ["M17 14V2", "M9 18.1L10 14H4.2a2 2 0 0 1-2-2.3l1.2-8A2 2 0 0 1 5.4 2H17v12l-4 8a2.4 2.4 0 0 1-2-2v-2z"],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  compass: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M16.2 7.8l-2.3 6.1-6.1 2.3 2.3-6.1z"],
  telescope: ["M10 3l9 5", "M3 11l7 4", "M13 21l4-14", "M7 21h10"],
  brain: ["M9 3a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0 1.5 2.6A3 3 0 0 0 6 17a3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z", "M15 3a3 3 0 0 1 3 3 3 3 0 0 1 3 3 3 3 0 0 1-1.5 2.6A3 3 0 0 1 18 17a3 3 0 0 1-3 3 3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"],
};

export type IconName = keyof typeof PATHS;

interface IconProps extends SVGProps<SVGSVGElement> {
  name: string;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  const paths = PATHS[name] ?? PATHS.info;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
