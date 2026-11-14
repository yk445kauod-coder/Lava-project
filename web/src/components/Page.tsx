import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Count } from "./Count";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n/provider";

/** Standard page header: title + optional subtitle and trailing controls. */
export function PageHead({
  title,
  sub,
  back,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="grow">
        {back && (
          <Link className="page-back" to={back.to}>
            <Icon name="chevron-left" size={15} /> {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {sub !== undefined && <p>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** A metric tile. `value` animates unless `count` is false (e.g. a text value). */
export function Stat({
  label,
  value,
  sub,
  count = true,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  count?: boolean;
}) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="n">{count ? <Count value={value} /> : value}</div>
      {sub !== undefined && <div className="s">{sub}</div>}
    </div>
  );
}

/** A titled panel with an optional trailing caption. */
export function Panel({
  title,
  sub,
  children,
  className = "panel reveal",
  actions,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={className}>
      {title !== undefined && (
        <div className="panel-h">
          <h2>{title}</h2>
          {actions ?? (sub !== undefined && <small>{sub}</small>)}
        </div>
      )}
      {children}
    </section>
  );
}

/** Centred empty / message state with an icon. */
export function Empty({ children, icon = "info" }: { children: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <span className="empty-dot" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <span>{children}</span>
    </div>
  );
}

/** Shimmering placeholder bars shown while a panel loads. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ padding: "16px 18px" }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skel mb ${i === 0 ? "lg w40" : i % 2 ? "w60" : ""}`} />
      ))}
    </div>
  );
}

/** A failed load, with a retry button so the user is never left at a dead end. */
export function LoadError({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="empty">
      <Icon name="alert" size={28} />
      <span>{message}</span>
      {onRetry && (
        <button className="btn ghost sm" type="button" style={{ marginTop: 10 }} onClick={onRetry}>
          <Icon name="refresh" size={15} />
          {t("Try again")}
        </button>
      )}
    </div>
  );
}
