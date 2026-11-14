import { useEffect, useMemo, useRef, useState } from "react";

import { clamp } from "../format";
import { useI18n } from "./provider";

const LS_CACHE = (l: string) => `lava.i18n.${l}`;

function readCache(l: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_CACHE(l)) ?? "{}") || {};
  } catch {
    return {};
  }
}

/**
 * Translate dynamic content - an insight title, an experiment summary, a
 * document title - through the same provider chain the UI shell uses, sharing
 * its cache so a string is paid for once. Values come back unchanged until a
 * translation lands, then re-render in the active language. English is a no-op.
 */
export function useTranslated<T extends string | null | undefined>(values: T[]): T[] {
  const { lang, bundle } = useI18n();
  const keys = values.map((v) => (v == null ? "" : String(v)));
  // Callers build `values` inline (a fresh array every render), so the effect
  // must key off the string content, not the array identity. With an unstable
  // dependency the cleanup runs on every render, cancels the in-flight request
  // and the translations never land.
  const sig = keys.join("\u0000");
  const [dict, setDict] = useState<Record<string, string>>(() => (lang === "en" ? {} : readCache(lang)));
  // Strings already sent to the service this session. The translator can drop a
  // string from a batch, and without this a dropped string stays "missing" and
  // the effect re-requests the same batch forever.
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    setDict(lang === "en" ? {} : readCache(lang));
    asked.current = new Set();
  }, [lang]);

  useEffect(() => {
    if (lang === "en") return;
    const resolve = (k: string) => dict[k] ?? bundle[k];
    const need = [...new Set(keys.filter((k) => k && !resolve(k) && !asked.current.has(k)))];
    if (!need.length) return;
    let alive = true;
    const id = window.setTimeout(() => {
      // Mark as asked only now, as the request leaves: the render above can be
      // torn down by a re-render inside the debounce window, and marking earlier
      // would strand those strings untranslated for the rest of the session.
      need.forEach((k) => asked.current.add(k));
      fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: lang, strings: need.slice(0, 200) }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { translations?: Record<string, string> } | null) => {
          if (!alive || !j?.translations) return;
          // A service that returns nothing for these strings must not trigger
          // another pass: without this guard `dict` gets a fresh (equal) object
          // every round and the effect re-fires forever.
          if (!Object.keys(j.translations).length) return;
          const merged = { ...readCache(lang), ...j.translations };
          try {
            localStorage.setItem(LS_CACHE(lang), JSON.stringify(merged));
          } catch {
            /* storage unavailable */
          }
          setDict(merged);
        })
        .catch(() => undefined);
    }, 80);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, sig, dict]);

  return useMemo(
    () => values.map((v) => (v == null ? v : (dict[String(v)] ?? bundle[String(v)] ?? String(v)))) as T[],
    [values, dict, bundle],
  );
}

/**
 * Translate long values, then shorten each to `n` characters for display.
 *
 * Clamping has to happen after the lookup: a truncated string never matches the
 * cache, so `useTranslated([clamp(title, 42)])` leaves every long title in
 * English and the page mixes two languages. Translate the full value first.
 */
export function useTranslatedClamped(values: (string | null | undefined)[], n: number): string[] {
  const translated = useTranslated(values);
  return useMemo(() => translated.map((v) => clamp(v, n)), [translated, n]);
}
