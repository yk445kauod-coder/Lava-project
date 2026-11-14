import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../lib/i18n/provider";
import { PsiSection, psiTables, visibleColumns, type PsiRecord } from "./PsiTables";

// The shape the worker returns for `/experiments/:code` -> `psi`.
const payload: PsiRecord = {
  investigations: [
    {
      id: "PSI-25",
      version: "4",
      doi: "10.60555/4qc4-de67",
      license: "CC0-1.0",
      title: "Burning and Suppression of Solids II",
      acronym: "BASS-II",
      url: "https://psi.nasa.gov/physci/repo/data/investigations/PSI-25",
      research_area: "Combustion Science",
      sub_area: "Spacecraft Fire Safety",
      project_type: "Microgravity Investigation",
      flight_platform: "International Space Station (ISS)",
      managing_center: "Glenn Research Center (GRC)",
      start_date: "01-01-2010",
      end_date: "12-31-2022",
      tables: [
        {
          id: "15",
          title: "BASS-II",
          file_name: "PSI-25_Experimental table_BASS-II.csv",
          doi: "10.60555/4qc4-de67",
          license: "CC0-1.0",
          row_count: 129,
          columns: [
            { name: "PI", type: "text" },
            { name: "Test #", type: "text" },
            { name: "Final CO (ppm)", type: "number" },
          ],
          rows: [
            {
              PI: "Sacksteder",
              "Test #": "1",
              "Final CO (ppm)": "12.5",
              __index: 0,
              __test_id: null,
              __test_date: null,
            },
          ],
        },
      ],
    },
  ],
  summary: { investigations: 1, tables: 1, rows: 129 },
};

describe("visibleColumns", () => {
  it("keeps the published column order", () => {
    expect(visibleColumns(payload.investigations[0].tables[0])).toEqual([
      "PI",
      "Test #",
      "Final CO (ppm)",
    ]);
  });

  it("drops the loader's bookkeeping keys", () => {
    const names = visibleColumns({
      columns: [
        { name: "PI" },
        { name: "__index" },
        { name: "__test_id" },
        { name: "__test_date" },
      ],
    });
    expect(names).toEqual(["PI"]);
  });
});

describe("psiTables", () => {
  it("collects tables across every linked investigation", () => {
    expect(psiTables(payload).map((t) => t.id)).toEqual(["15"]);
  });

  it("is empty when nothing is linked", () => {
    expect(psiTables(null)).toEqual([]);
    expect(psiTables({ investigations: [], summary: null })).toEqual([]);
  });
});

describe("PsiSection", () => {
  it("renders the measured values, not just the record header", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PsiSection psi={payload} />
      </I18nProvider>,
    );
    expect(html).toContain("PSI-25");
    expect(html).toContain("BASS-II");
    expect(html).toContain("Sacksteder");
    expect(html).toContain("12.5");
    expect(html).toContain("Final CO (ppm)");
    expect(html).not.toContain("__index");
  });

  it("renders nothing when there is no linked record", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <PsiSection psi={null} />
      </I18nProvider>,
    );
    expect(html).toBe("");
  });
});
