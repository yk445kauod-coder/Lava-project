/**
 * Row coercion for the JSON the API returns.
 *
 * Postgres `bigint`/`numeric` come back over the Neon HTTP driver as strings
 * (`"206"`, `"0.8809"`), which breaks `toLocaleString`/`toFixed`/arithmetic on
 * the client and renders real data as a dash. Only explicitly listed keys are
 * touched - ids and source ids must stay strings to preserve leading zeros.
 */
export function numify<T extends Record<string, any>>(rows: T[], keys: string[]): T[] {
  const kset = new Set(keys);
  return rows.map((row) => {
    const out: Record<string, any> = { ...row };
    for (const k of Object.keys(out)) {
      if (!kset.has(k)) continue;
      const v = out[k];
      if (v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v))) out[k] = Number(v);
    }
    return out as T;
  });
}

/** Same coercion for a single object (e.g. the document_stats row). */
export function numifyOne<T extends Record<string, any>>(row: T | undefined, keys: string[]): T {
  if (!row) return {} as T;
  return numify([row], keys)[0];
}
