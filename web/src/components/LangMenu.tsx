import { useEffect, useRef, useState } from "react";

import { CODES, LOCALES } from "../lib/i18n/locales";
import { useI18n } from "../lib/i18n/provider";
import { Icon } from "./Icon";

/** Globe control with the locale dropdown. Switching locale updates the
 *  provider in place (no reload): bundled Arabic applies instantly, the rest
 *  fill from /api/translate. */
export function LangMenu() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="lang" ref={ref}>
      <button
        className="icon-btn lang-btn"
        type="button"
        aria-label={t("Language")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Icon name="globe" size={20} />
      </button>
      <div className="lang-menu" hidden={!open}>
        {LOCALES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={l.code === lang ? "on" : ""}
            onClick={() => {
              if (CODES.has(l.code)) setLang(l.code);
              setOpen(false);
            }}
          >
            <span>{l.name}</span>
            <span className="code mono2">{l.code.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
