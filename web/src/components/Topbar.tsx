import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiGet } from "../lib/api";
import { BrandLogo } from "./BrandLogo";
import { fmt } from "../lib/format";
import { useI18n } from "../lib/i18n/provider";
import { Icon } from "./Icon";
import { LangMenu } from "./LangMenu";
import { ThemeToggle } from "./ThemeToggle";

interface HealthStats {
  documents?: unknown;
  chunks?: unknown;
  experiments?: unknown;
}

/** Live corpus status pill, driven by /api/health. Distinguishes "still
 *  connecting" from a failed check so the first paint never reads as Offline. */
function MissionStatus() {
  const { t } = useI18n();
  const [state, setState] = useState<{ phase: "loading" | "live" | "offline"; stats?: HealthStats }>({
    phase: "loading",
  });

  useEffect(() => {
    let alive = true;
    apiGet<{ stats?: HealthStats }>("/api/health")
      .then((h) => alive && setState({ phase: "live", stats: h.stats || {} }))
      .catch(() => alive && setState({ phase: "offline" }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.phase === "loading") {
    return (
      <span className="mission is-loading" id="mission" aria-live="polite">
        <i className="dot pulse" />
        <b>{t("Connecting...")}</b>
      </span>
    );
  }
  if (state.phase === "offline") {
    return (
      <span className="mission is-offline" id="mission" title={t("Could not reach the corpus service")}>
        <i className="dot" style={{ background: "var(--flame)" }} />
        <b>{t("Offline")}</b>
      </span>
    );
  }
  const s = state.stats || {};
  return (
    <span
      className="mission"
      id="mission"
      title={`${fmt(s.chunks)} ${t("passages")} · ${fmt(s.experiments)} ${t("experiments")}`}
    >
      <i className="dot" />
      <b>{t("Live")}</b> · {fmt(s.documents)} {t("docs")}
    </span>
  );
}

/** UTC clock; the numerals stay LTR/mono in RTL layouts. */
function Clock() {
  const { lang } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const loc = lang === "ar" ? "ar" : lang === "zh" ? "zh-CN" : lang;
  const date = now.toLocaleDateString(loc, { month: "short", day: "numeric", year: "numeric" });
  const time = now.toLocaleTimeString(loc, { hour12: false });
  return (
    <span className="clock" id="clock">
      <span className="mono2">{date}</span>{" "}
      <span className="mono2" style={{ color: "#fff" }}>
        {time}
      </span>
    </span>
  );
}

interface TopbarProps {
  search?: string;
  onOpenNav?: () => void;
}

/** Console topbar: mobile menu, global search, live status, clock, controls. */
export function Topbar({ search = "", onOpenNav }: TopbarProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState(search);

  return (
    <div className="topbar">
      <BrandLogo className="brand-mini only-mobile" />
      <button className="icon-btn only-mobile" type="button" aria-label={t("Open menu")} onClick={onOpenNav}>
        <Icon name="menu" size={20} />
      </button>
      <label className="search">
        <Icon name="search" size={16} />
        <input
          id="globalSearch"
          placeholder={t("Search documents, experiments, findings")}
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
        />
        <kbd>↵</kbd>
      </label>
      <MissionStatus />
      <Clock />
      <span className="topbar-extra hide-sm">
        <LangMenu />
        <ThemeToggle />
      </span>
    </div>
  );
}
