import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/** Width at or below which the sidebar becomes an off-canvas drawer. Kept in
 *  sync with the `@media(max-width:760px)` blocks in app.css / styles.css. */
const DRAWER_QUERY = "(max-width: 760px)";

/** True while the off-canvas drawer breakpoint is active. */
export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(DRAWER_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DRAWER_QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

/** Off-canvas drawer behaviour shared by the console shell and the chat view.
 *
 *  The drawer is always mounted, so three things must be handled explicitly:
 *  the page behind it must not scroll, a closed drawer must not be reachable by
 *  keyboard or screen reader, and focus must return to the control that opened
 *  it. Escape and a route change both dismiss it. */
export function useMobileDrawer() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const { pathname } = useLocation();

  const openDrawer = useCallback(() => {
    opener.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    opener.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, closeDrawer]);

  // Navigating from inside the drawer should close it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Growing past the drawer breakpoint docks the sidebar; drop the open state so
  // the body scroll lock is released and the mobile chrome stops applying.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 761px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return { navOpen: open, openDrawer, closeDrawer };
}
