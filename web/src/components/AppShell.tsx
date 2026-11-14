import { useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useI18n } from "../lib/i18n/provider";
import { useIsMobile, useMobileDrawer } from "../lib/useMobileDrawer";
import { useScrollReveal } from "../lib/useReveal";
import { useSheetDrag } from "../lib/useSheetDrag";
import { Icon } from "./Icon";
import { LangMenu } from "./LangMenu";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { Topbar } from "./Topbar";

interface AppShellProps {
  children: ReactNode;
  /** Sidebar subtitle, e.g. "Mission Overview". */
  subtitle?: string;
  /** Pre-filled value for the topbar search box. */
  search?: string;
  /** Extra sidebar content rendered under the nav (LAVA Intelligence uses this). */
  sidebarExtra?: ReactNode;
  /** Hide the sidebar entirely (used by the full-width chat view). */
  hideSidebar?: boolean;
}

/** Mobile-only bottom sheet for the secondary console actions. Primary
 *  navigation lives in the bottom navbar; this holds the rest. */
function ShellMore({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { dragStyle, handlers } = useSheetDrag(onClose);
  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };
  return (
    <div className={`m-sheet m-more${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" style={dragStyle}>
        <div className="sheet-handle" aria-hidden="true" {...handlers}>
          <span />
        </div>
        <button className="m-more-row" type="button" onClick={go("/dashboard")}>
          <Icon name="grid" size={18} /> {t("Home")}
        </button>
        <div className="m-more-row">
          <Icon name="globe" size={18} /> <span>{t("Language")}</span>
          <span className="m-more-ctl">
            <LangMenu />
          </span>
        </div>
        <div className="m-more-row">
          <Icon name="sun" size={18} /> <span>{t("Theme")}</span>
          <span className="m-more-ctl">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </div>
  );
}

/** The console chrome shared by every in-app page: sidebar + topbar around a
 *  scrollable `.content` region. Mobile drawer state lives here. */
export function AppShell({ children, subtitle, search, sidebarExtra, hideSidebar = false }: AppShellProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { navOpen, openDrawer, closeDrawer } = useMobileDrawer();
  const isMobile = useIsMobile();
  const [moreOpen, setMoreOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useScrollReveal(contentRef);

  // On a phone the drawer is mounted but off-screen; keep it out of the tab
  // order and the accessibility tree until it opens.
  const offCanvas = isMobile && !navOpen;

  return (
    <div className="console">
      <div className={`app${navOpen ? " nav-open" : ""}`} id="app">
        <div className="scrim" id="scrim" onClick={closeDrawer} />
        {!hideSidebar && (
          <Sidebar
            subtitle={subtitle}
            offCanvas={offCanvas}
            onClose={closeDrawer}
          >
            {sidebarExtra}
          </Sidebar>
        )}
        <main className="main">
          <Topbar search={search} onOpenNav={openDrawer} />
          <div className="content" ref={contentRef}>
            {children}
          </div>
        </main>

        <nav className="m-botnav" aria-label={t("Primary")}>
          <button className={`m-nav-btn${pathname !== "/chat" ? " on" : ""}`} type="button" onClick={openDrawer}>
            <Icon name="menu" size={19} />
            <span>{t("Menu")}</span>
          </button>
          <button className={`m-nav-btn${pathname === "/chat" ? " on" : ""}`} type="button" onClick={() => navigate("/chat")}>
            <Icon name="comments" size={19} />
            <span>{t("Assistant")}</span>
          </button>
          <button className="m-nav-btn" type="button" onClick={() => setMoreOpen(true)}>
            <Icon name="more" size={19} />
            <span>{t("More")}</span>
          </button>
        </nav>
      </div>
      <ShellMore open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  );
}
