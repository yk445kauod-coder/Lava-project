import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useI18n } from "../lib/i18n/provider";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "./Icon";
import { LangMenu } from "./LangMenu";
import { ThemeToggle } from "./ThemeToggle";

const SECTIONS = [
  { href: "#science", label: "Science" },
  { href: "#features", label: "Features" },
  { href: "#workflow", label: "How it works" },
  { href: "#corpus", label: "Corpus" },
];

/** Landing header. Always opaque (never transparent) so links stay legible
 *  over the busy hero; scrolling only deepens the shadow. */
export function MarketingHeader() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  // On a standalone page (e.g. /about) the in-page #anchors do not exist, so the
  // header links back to the landing sections instead of jumping nowhere.
  const home = pathname !== "/";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nav${scrolled ? " scrolled" : ""}`} id="nav">
      <div className="wrap nav-in">
        <BrandLogo className="brand" />
        <nav className={`links${open ? " open" : ""}`} id="links" aria-label="Main">
          {SECTIONS.map((s) => (
            <Link key={s.href} to={home ? `/${s.href}` : s.href} onClick={() => setOpen(false)}>
              {t(s.label)}
            </Link>
          ))}
          <Link to="/about" onClick={() => setOpen(false)}>
            {t("About")}
          </Link>
        </nav>
        <div className="nav-act">
          <LangMenu />
          <ThemeToggle />
          <Link className="btn ghost hide-sm" to="/login">
            {t("Sign in")}
          </Link>
          <Link className="btn primary hide-sm" to="/dashboard">
            {t("Open dashboard")}
          </Link>
          <button
            className="icon-btn menu-btn"
            type="button"
            aria-label={t("Open menu")}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "close" : "menu"} size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
