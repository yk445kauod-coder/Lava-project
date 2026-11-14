import { AR } from "./dict";

const DICT: Record<string, Record<string, string>> = { ar: AR };

/** Pure lookup shared by the React provider and its tests. Bundled dictionaries
 *  take precedence over the machine-translation cache, then the source string. */
export function translate(
  lang: string,
  cache: Record<string, string>,
  source: string,
  bundle: Record<string, string> = {},
): string {
  const key = String(source ?? "");
  if (lang === "en" || !key) return key;
  return bundle[key] || DICT[lang]?.[key] || cache[key] || key;
}
