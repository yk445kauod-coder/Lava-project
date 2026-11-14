import { useState, type ReactNode } from "react";

import { AppShell } from "../../components/AppShell";
import { Chart } from "../../components/Chart";
import { Icon } from "../../components/Icon";
import { Empty, PageHead, Panel, Skeleton } from "../../components/Page";
import { Toast, useToast } from "../../components/Toast";
import { apiPost } from "../../lib/api";
import { barList } from "../../lib/chart";
import { fmt, num, pct } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import { useTranslated, useTranslatedClamped } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

interface ExperimentSummary {
  id: unknown;
  code: string;
  name: string | null;
}

interface ListResponse {
  experiments?: ExperimentSummary[];
}

interface CompareExperiment {
  id: unknown;
  code: string;
  name: string | null;
  campaign: string | null;
  facility: string | null;
  facility_name: string | null;
  platform: string | null;
  status: string | null;
  gravity_level: unknown;
  fuel_type: string | null;
  sample_geometry: string | null;
  fuel_thickness: unknown;
  ambient_gas: string | null;
  pressure_kpa: unknown;
  o2_fraction: unknown;
  flow_velocity: unknown;
  flow_velocity_unit: string | null;
  ignition_source: string | null;
  objective: string | null;
  summary: string | null;
  document_count: unknown;
}

interface MetricValue {
  value: unknown;
  value_max: unknown;
  unit: string | null;
}

interface MetricRow {
  metric: string;
  values: Record<string, MetricValue[]>;
}

interface CompareResponse {
  experiments?: CompareExperiment[];
  dimensions?: string[];
  metric_matrix?: MetricRow[];
  note?: string;
}

/** Dimensions shown in the conditions table, in display order. */
const DIMS: { key: keyof CompareExperiment; label: string }[] = [
  { key: "campaign", label: "Campaign" },
  { key: "facility", label: "Facility" },
  { key: "platform", label: "Platform" },
  { key: "status", label: "Status" },
  { key: "gravity_level", label: "Gravity" },
  { key: "fuel_type", label: "Fuel" },
  { key: "sample_geometry", label: "Sample shape" },
  { key: "fuel_thickness", label: "Thickness" },
  { key: "ambient_gas", label: "Ambient gas" },
  { key: "o2_fraction", label: "O₂" },
  { key: "pressure_kpa", label: "Pressure" },
  { key: "flow_velocity", label: "Flow velocity" },
  { key: "ignition_source", label: "Ignition" },
  { key: "document_count", label: "Documents" },
];

export default function Compare() {
  const { t } = useI18n();
  const { data, loading, error } = useApi<ListResponse>("/api/experiments");
  const [msg, toast] = useToast();

  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const exps = data?.experiments ?? [];

  const toggle = (code: string) =>
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  /** A single conditions cell; null-ish values read "not reported", never 0. */
  const cell = (v: unknown, dim: keyof CompareExperiment): ReactNode => {
    if (v === null || v === undefined || v === "") {
      return <span className="muted">{t("not reported")}</span>;
    }
    if (dim === "o2_fraction") return pct(v);
    if (dim === "pressure_kpa") return `${fmt(v)} kPa`;
    if (dim === "flow_velocity") {
      const n = num(v);
      return n === null ? t("not reported") : `${fmt(n)} cm/s`;
    }
    if (dim === "fuel_thickness") {
      const n = num(v);
      return n === null ? t("not reported") : `${fmt(n)} mm`;
    }
    if (dim === "gravity_level") {
      const n = num(v);
      return n === null ? t("not reported") : `${n.toExponential(1)} g`;
    }
    return String(v);
  };

  const runCompare = async () => {
    if (selected.length < 2) {
      toast(t("Select at least two experiments"));
      return;
    }
    setComparing(true);
    setCompareError(null);
    try {
      const d = await apiPost<CompareResponse>("/api/compare", { experiments: selected });
      setResult(d);
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setComparing(false);
    }
  };

  const expList = result?.experiments ?? [];
  const codes = expList.map((e) => e.code);
  const matrix = result?.metric_matrix ?? [];
  const metricT = useTranslated(matrix.map((row) => row.metric));
  const chipNames = useTranslatedClamped(exps.map((x) => x.name), 26);

  const docBars = expList.map((e) => ({
    label: e.code,
    value: num(e.document_count) ?? 0,
  }));

  // `metric_matrix.values` is keyed by experiment id, not code.
  const metricBars = matrix.slice(0, 10).map((row, i) => ({
    label: metricT[i] || row.metric,
    value: expList.reduce((a, e) => a + (row.values[String(e.id)]?.length ?? 0), 0),
    sub: `${t("across")} ${codes.length} ${t("experiments")}`,
  }));

  return (
    <AppShell subtitle={t("Comparative Analysis")}>
      <PageHead
        title={t("Comparative Analysis")}
        sub={t("put experiments side by side across conditions and metrics")}
      />

      <Panel
        title={t("Select experiments")}
        sub={selected.length ? `${selected.length} ${t("selected")}` : t("pick two or more")}
        className="panel reveal"
      >
        <div style={{ padding: "14px 18px 18px" }}>
          {loading ? (
            <Skeleton rows={2} />
          ) : error ? (
            <Empty icon="alert">{error}</Empty>
          ) : exps.length ? (
            <div className="hstack wrap">
              {exps.map((x, i) => (
                <button
                  key={x.code}
                  type="button"
                  className={`chip${selected.includes(x.code) ? " on" : ""}`}
                  aria-pressed={selected.includes(x.code)}
                  onClick={() => toggle(x.code)}
                >
                  {x.code} · {chipNames[i] || "-"}
                </button>
              ))}
            </div>
          ) : (
            <Empty icon="flask">{t("No experiments")}</Empty>
          )}
          <button className="btn primary" style={{ marginTop: 14 }} onClick={runCompare} disabled={comparing}>
            <Icon name="compare" size={16} />
            {t("Compare")}
          </button>
        </div>
      </Panel>

      {comparing && (
        <Panel>
          <Empty icon="info">{t("comparing...")}</Empty>
        </Panel>
      )}

      {!comparing && compareError && (
        <Panel>
          <Empty icon="alert">{compareError}</Empty>
        </Panel>
      )}

      {!comparing && !compareError && result && (
        <>
          {result.experiments?.length ? (
            <>
              <div className="two-a">
                <Panel title={t("Documents per experiment")}>
                  <Chart html={docBars.length ? barList(docBars, { unit: t("docs") }) : null} />
                </Panel>
                <Panel title={t("Shared metrics")} sub={t("measurements available in each")}>
                  <Chart html={metricBars.length ? barList(metricBars, { unit: t("rows") }) : null} />
                </Panel>
              </div>

              <Panel
                title={t("Conditions")}
                sub={`${codes.length} ${t("experiments")}`}
                className="panel reveal"
              >
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>{t("Dimension")}</th>
                        {result.experiments.map((e) => (
                          <th key={e.code}>{e.code}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DIMS.map(({ key, label }) => (
                        <tr key={key}>
                          <td>
                            <b>{t(label)}</b>
                          </td>
                          {result.experiments!.map((e) => (
                            <td key={e.code}>{cell(e[key], key)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel
                title={t("Measured metrics")}
                sub={`${fmt(matrix.length)} ${t("metrics in common")}`}
                className="panel reveal"
              >
                <div className="tbl-scroll">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>{t("Metric")}</th>
                        {result.experiments.map((e) => (
                          <th key={e.code}>{e.code}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.length ? (
                        matrix.map((row, mi) => (
                          <tr key={row.metric}>
                            <td>
                              <b>{metricT[mi] || row.metric}</b>
                            </td>
                            {result.experiments!.map((e) => {
                              const vals = row.values[String(e.id)] ?? [];
                              return (
                                <td className="num" key={e.code}>
                                  {vals.length ? (
                                    vals
                                      .map((v) => {
                                        const vm = num(v.value_max);
                                        const range =
                                          vm !== null && vm !== num(v.value) ? `-${fmt(vm)}` : "";
                                        return `${fmt(v.value)}${range}${v.unit ? ` ${v.unit}` : ""}`;
                                      })
                                      .join(", ")
                                  ) : (
                                    <span className="muted">-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="empty" colSpan={result.experiments!.length + 1}>
                            {t("No shared metrics")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          ) : (
            <Panel>
              <Empty icon="compare">{result.note || t("No experiments")}</Empty>
            </Panel>
          )}
        </>
      )}

      <Toast message={msg} />
    </AppShell>
  );
}
