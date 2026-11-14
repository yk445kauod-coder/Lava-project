import { useEffect } from "react";
import { useRouteError } from "react-router-dom";

import { useI18n } from "../lib/i18n/provider";

/** A lazy route chunk can 404 when the open tab was served by an older
 *  deployment: the HTML still names a bundle the new deploy no longer ships.
 *  Cloudflare Pages answers the missing file with the SPA fallback, so the
 *  import receives HTML instead of JavaScript and the dynamic import rejects.
 *  Reloading picks up the current HTML and its matching bundle. */
export function isStaleChunkError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk \S+ failed/i.test(
    msg,
  );
}

export default function RouteError() {
  const error = useRouteError();
  const { t } = useI18n();
  const stale = isStaleChunkError(error);

  useEffect(() => {
    if (!stale) return;
    // Reload once so a stale tab heals itself; the guard stops a loop when the
    // deployment itself is broken rather than merely superseded.
    const KEY = "lava.reloadedAt";
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }, [stale]);

  return (
    <div className="errwrap">
      <div className="errbox">
        <h1>{stale ? t("Updating to the latest version") : t("Something went wrong")}</h1>
        <p>
          {stale
            ? t("A new version is ready. Reload to continue.")
            : t("This page could not load. Try again, or head back to the start.")}
        </p>
        <div className="err-actions">
          <button
            className="err-btn primary"
            type="button"
            onClick={() => {
              sessionStorage.removeItem("lava.reloadedAt");
              window.location.reload();
            }}
          >
            {t("Reload")}
          </button>
          <a className="err-btn" href="/">
            {t("Go home")}
          </a>
        </div>
      </div>
    </div>
  );
}
