import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";

import { NAV } from "../lib/nav";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n/provider";
import { BrandLogo } from "./BrandLogo";
import { Icon } from "./Icon";

interface SidebarProps {
  subtitle?: string;
  initials?: string;
  profileName?: string;
  onClose?: () => void;
  /** Mounted but off-screen, so it must be inert to keyboard and screen readers. */
  offCanvas?: boolean;
  /** Extra content (chat history, new-chat button) rendered under the nav. */
  children?: ReactNode;
}

function initialsOf(s: string): string {
  const parts = s.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "L") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "A")).toUpperCase();
}

/** Console sidebar: brand, grouped navigation, profile. Pages with extra
 *  sidebar content (the LAVA Intelligence) pass it as children. */
export function Sidebar({
  subtitle = "Research Console",
  initials,
  profileName,
  onClose,
  offCanvas = false,
  children,
}: SidebarProps) {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const name = profileName || user?.name || user?.email || "LAVA Lab";
  const av = initials || initialsOf(name);
  return (
    <aside
      className="sidebar"
      id="sidebar"
      aria-label={t(subtitle)}
      aria-hidden={offCanvas || undefined}
      inert={offCanvas || undefined}
    >
      <div className="brand">
        <BrandLogo />
        <small>{t(subtitle)}</small>
        {onClose && (
          <button className="icon-btn only-mobile" type="button" aria-label={t("Close menu")} onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        )}
      </div>

      <nav className="nav">
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <div className="group-label">{t(group)}</div>
            {items.map((it) => (
              <NavLink key={it.id} to={it.href} end>
                <Icon name={it.icon} size={18} />
                <span>{t(it.label)}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {children}

      <div className="profile">
        <span className="avatar">{av}</span>
        <div>
          <b>{t(name)}</b>
          <small>{user?.email ? user.email : t("Research workspace")}</small>
        </div>
        {user ? (
          <button
            className="icon-btn"
            type="button"
            aria-label={t("Sign out")}
            title={t("Sign out")}
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <Icon name="logout" size={18} />
          </button>
        ) : (
          <button
            className="icon-btn"
            type="button"
            aria-label={t("Sign in")}
            title={t("Sign in")}
            onClick={() => navigate("/login")}
          >
            <Icon name="logout" size={18} />
          </button>
        )}
      </div>
    </aside>
  );
}
