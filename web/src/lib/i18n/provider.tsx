import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AR } from "./dict";
import { CODES, LOCALES, RTL_CODES } from "./locales";
import { loadLocale } from "./locales/index";

const LS_LANG = "lava.lang";
const LS_CACHE = (l: string) => `lava.i18n.${l}`;
const DICT: Record<string, Record<string, string>> = { ar: AR };

function readLang(): string {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LANG) ?? "null");
    if (typeof v === "string" && CODES.has(v)) return v;
  } catch {
    /* fall through to navigator */
  }
  const n = (navigator.language || "en").slice(0, 2).toLowerCase();
  return CODES.has(n) ? n : "en";
}

function loadCache(l: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_CACHE(l)) ?? "{}") || {};
  } catch {
    return {};
  }
}

interface I18nValue {
  lang: string;
  isRTL: boolean;
  locales: typeof LOCALES;
  t: (s: string) => string;
  /** Curated, hand-written strings for the active locale (no machine pass). */
  bundle: Record<string, string>;
  setLang: (code: string) => void;
  /** True while a machine locale is still fetching its first translations. */
  translating: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<string>(readLang);
  const [cache, setCache] = useState<Record<string, string>>(() => loadCache(readLang()));
  // The bundled dictionary for the active locale, loaded as its own chunk.
  const [bundle, setBundle] = useState<Record<string, string>>(() => DICT[readLang()] ?? {});
  const [translating, setTranslating] = useState(false);
  // Every source string `t()` has been asked for, so a locale switch can
  // translate the whole visible UI rather than just the one string that changed.
  const seen = useRef<Set<string>>(new Set());
  const inflight = useRef(false);

  // Apply the language to the document, then load its bundled dictionary and any
  // machine-translation cache. The bundle is the primary source; the cache only
  // ever holds strings the bundle does not cover.
  useEffect(() => {
    const el = document.documentElement;
    el.lang = lang;
    el.dir = RTL_CODES.has(lang) ? "rtl" : "ltr";
    el.dataset.lang = lang;
    setCache(loadCache(lang));
    setBundle(DICT[lang] ?? {});
    let alive = true;
    void loadLocale(lang).then((dict) => {
      if (alive && Object.keys(dict).length) setBundle(dict);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  const fill = useCallback(
    async (locale: string, need: string[]) => {
      if (locale === "en") return;
      const bundled = DICT[locale] ?? bundle;
      const cached = loadCache(locale);
      // Bundled (hand-written) strings are curated overrides; only gaps fill.
      const unique = [...new Set(need)].filter((s) => s && !bundled[s] && !cached[s]);
      if (!unique.length || inflight.current) return;
      inflight.current = true;
      setTranslating(true);
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, strings: unique }),
        });
        if (!res.ok) return;
        const j = (await res.json()) as { translations?: Record<string, string> };
        // Merge against the cache as it stands now, not as it stood when the
        // request went out. The dynamic-content hook writes to the same key,
        // and a read-modify-write from a stale snapshot would drop its entries.
        const merged = { ...loadCache(locale), ...(j.translations || {}) };
        try {
          localStorage.setItem(LS_CACHE(locale), JSON.stringify(merged));
        } catch {
          /* storage unavailable - translations just do not persist */
        }
        // Only publish if the user is still on this locale.
        setCache((cur) => (locale === lang ? merged : cur));
      } catch {
        /* offline - fall back to the source string */
      } finally {
        inflight.current = false;
        setTranslating(false);
      }
    },
    [bundle],
  );

  const t = useCallback(
    (s: string) => {
      const key = String(s ?? "");
      if (key && lang !== "en") seen.current.add(key);
      if (!key || lang === "en") return key;
      // Bundled dictionary first, then any machine-translation cache, then the
      // English source string.
      return bundle[key] || cache[key] || key;
    },
    [lang, cache, bundle],
  );

  // On a locale switch, translate everything the UI has asked for. Re-runs as
  // `cache` grows, so strings that register after navigation (a page that was
  // not mounted at switch time) are picked up too. A short debounce coalesces a
  // page's worth of `t()` calls into one request instead of one per string.
  useEffect(() => {
    if (lang === "en") return;
    let alive = true;
    const id = window.setTimeout(() => {
      if (alive) void fill(lang, [...seen.current]);
    }, 60);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [lang, cache, fill]);

  const setLang = useCallback((code: string) => {
    const next = CODES.has(code) ? code : "en";
    try {
      localStorage.setItem(LS_LANG, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setLangState(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, isRTL: RTL_CODES.has(lang), locales: LOCALES, t, bundle, setLang, translating }),
    [lang, t, bundle, setLang, translating],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
