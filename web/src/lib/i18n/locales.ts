export interface Locale {
  code: string;
  name: string;
  rtl: boolean;
}

/** Locales the worker can translate to; `rtl` flips the layout direction. */
export const LOCALES: Locale[] = [
  { code: "en", name: "English", rtl: false },
  { code: "ar", name: "العربية", rtl: true },
  { code: "fr", name: "Français", rtl: false },
  { code: "es", name: "Español", rtl: false },
  { code: "de", name: "Deutsch", rtl: false },
  { code: "pt", name: "Português", rtl: false },
  { code: "ru", name: "Русский", rtl: false },
  { code: "zh", name: "中文", rtl: false },
  { code: "ja", name: "日本語", rtl: false },
  { code: "hi", name: "हिन्दी", rtl: false },
];

export const CODES = new Set(LOCALES.map((l) => l.code));
export const RTL_CODES = new Set(LOCALES.filter((l) => l.rtl).map((l) => l.code));
