import { useTranslated } from "../lib/i18n/data";
import { useI18n } from "../lib/i18n/provider";
import { fmt } from "../lib/format";

export interface PsiColumn {
  name: string;
  type?: string | null;
}

export interface PsiTable {
  id: string;
  title: string | null;
  file_name: string | null;
  doi: string | null;
  license: string | null;
  row_count: number;
  columns: PsiColumn[];
  rows: Record<string, unknown>[];
}

export interface PsiInvestigation {
  id: string;
  version: string | null;
  doi: string | null;
  license: string | null;
  title: string | null;
  acronym: string | null;
  url: string | null;
  research_area: string | null;
  sub_area: string | null;
  project_type: string | null;
  flight_platform: string | null;
  managing_center: string | null;
  start_date: string | null;
  end_date: string | null;
  tables: PsiTable[];
}

/** Internal row keys the loader adds alongside the published columns. */
const META_KEYS = new Set(["__index", "__test_id", "__test_date"]);

/** The published column names for a table, in source order, without the
 *  bookkeeping keys the loader attaches to every row. */
export function visibleColumns(table: Pick<PsiTable, "columns">): string[] {
  return (table.columns ?? []).map((c) => c.name).filter((n) => n && !META_KEYS.has(n));
}

/** Every table an experiment's PSI payload carries, across all investigations. */
export function psiTables(psi: PsiRecord | null | undefined): PsiTable[] {
  return (psi?.investigations ?? []).flatMap((inv) => inv.tables ?? []);
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  return String(v);
}

/** One published PSI table: its provenance line, then the measured rows as
 *  NASA published them. Column headers keep the original names because the
 *  values are only meaningful against the source spreadsheet. */
function TableCard({ table, index }: { table: PsiTable; index: number }) {
  const { t } = useI18n();
  const [title, fileName] = useTranslated([table.title, table.file_name]);
  const columns = visibleColumns(table);

  return (
    <div className="psi-table">
      <div className="psi-table-head">
        <div className="hstack wrap" style={{ gap: 8, alignItems: "baseline" }}>
          <b>{title || fileName || `${t("Table")} ${index + 1}`}</b>
          <span className="small muted">
            {fmt(table.row_count)} {t("rows")} · {columns.length} {t("columns")}
          </span>
        </div>
        {fileName && fileName !== title && <div className="small muted mono2">{fileName}</div>}
      </div>
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {columns.map((name) => (
                <th key={name}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={String(row.__index ?? i)}>
                {columns.map((name) => (
                  <td key={name}>{cell(row[name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Every PSI record an experiment links to, with its published tables. */
export function PsiSection({ psi }: { psi: PsiRecord | null }) {
  const investigations = psi?.investigations ?? [];
  if (!investigations.length) return null;

  return (
    <>
      {investigations.map((inv) => (
        <PsiInvestigationCard key={inv.id} inv={inv} />
      ))}
    </>
  );
}

function PsiInvestigationCard({ inv }: { inv: PsiInvestigation }) {
  const { t } = useI18n();
  const [title] = useTranslated([inv.title]);
  const facts: [string, string | null][] = [
    [t("Research area"), inv.research_area],
    [t("Sub-area"), inv.sub_area],
    [t("Project type"), inv.project_type],
    [t("Flight platform"), inv.flight_platform],
    [t("Managing center"), inv.managing_center],
  ];

  return (
    <div className="psi-inv">
      <div className="psi-inv-head">
        <div className="hstack wrap" style={{ gap: 8, alignItems: "center" }}>
          <b className="mono2">{inv.id}</b>
          {inv.acronym && <span className="muted">{inv.acronym}</span>}
          {inv.version && <span className="muted">{t("Version")} {inv.version}</span>}
          {inv.license && <span className="muted">{inv.license}</span>}
        </div>
        {title && <p style={{ margin: "8px 0 6px" }}>{title}</p>}
        {inv.doi && (
          <div className="small muted">
            {t("DOI")}: <span className="mono2">{inv.doi}</span>
          </div>
        )}
        {inv.url && (
          <div className="meta" style={{ marginTop: 10 }}>
            <a className="cite" href={inv.url} target="_blank" rel="noreferrer">
              {t("Open on PSI")} →
            </a>
          </div>
        )}
      </div>

      <dl className="dl">
        {facts
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>

      {inv.tables.map((table, i) => (
        <TableCard key={table.id} table={table} index={i} />
      ))}
    </div>
  );
}

export interface PsiRecord {
  investigations: PsiInvestigation[];
  summary: { investigations: number; tables: number; rows: number } | null;
}
