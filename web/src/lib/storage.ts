/** Typed JSON helpers over localStorage, tolerant of legacy raw-string values
 *  (older builds stored `lava.theme` as `dark` rather than `"dark"`). */

export function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) - preferences just do not persist */
  }
}

export type Theme = "light" | "dark";

export function readTheme(): Theme | null {
  const v = getJSON<string | null>("lava.theme", null);
  return v === "dark" || v === "light" ? v : null;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  setJSON("lava.theme", theme);
  applyTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = readTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
