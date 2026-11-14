/** Render a PSI row (a `data` jsonb keyed by the table's original column
 *  names) as readable "column: value" content the agent can quote. */
export function renderPsiRow(row: any, columns: unknown): string {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const keys = Object.keys(data).filter((k) => !k.startsWith("__"));
  // `columns` is persisted as [{ name, type }] alongside the table metadata,
  // and the row's own keys are the published column names. Read the name out
  // of the objects; fall back to the row keys when it is absent or a bare
  // string list.
  const ordered: string[] = Array.isArray(columns)
    ? columns
        .map((c) => (typeof c === "string" ? c : c && typeof c === "object" ? (c as any).name : null))
        .filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];
  const cols = ordered.length ? ordered : keys;
  const parts: string[] = [];
  for (const col of cols) {
    const v = data[col];
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${col}: ${v}`);
  }
  // A row can carry values under keys the declared column list omits.
  for (const col of keys) {
    if (cols.includes(col)) continue;
    const v = data[col];
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${col}: ${v}`);
  }
  const head = [];
  if (row.test_id) head.push(`test ${row.test_id}`);
  if (row.test_date) head.push(row.test_date);
  const prefix = head.length ? `(${head.join(", ")}) ` : "";
  return prefix + (parts.join(" · ") || "(no values)");
}
