import { useMemo, useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { Empty, LoadError, PageHead, Panel, Skeleton } from "../../components/Page";
import { fmt, num } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import { useTranslated } from "../../lib/i18n/data";
import { useI18n } from "../../lib/i18n/provider";

interface Variable {
  key: string;
  label: string;
  unit: string;
  role?: string | null;
  n: number;
  documents: number;
  min: number | null;
  max: number | null;
  band_lo: number | null;
  band_hi: number | null;
  median: number | null;
  verified: number;
}

interface CoverageResponse {
  generated_at: string;
  note: string;
  variables: Variable[];
}

/** Map a key to a translated display label (falls back to the API label). */
const LABEL_KEY: Record<string, string> = {
  oxygen: "Oxygen concentration",
  limiting_oxygen: "Limiting oxygen index",
  flow: "Flow velocity",
  pressure: "Pressure",
  gravity: "Gravity level",
};

/** One variable's empirical band, drawn as a horizontal bar from min to max with
 *  a tick at the median. The band is the tested envelope, not a prediction. */
function Band({ v }: { v: Variable }) {
  const { t } = useI18n();
  const roleT = useTranslated([v.role]);
  const lo = num(v.min);
  const hi = num(v.max);
  const bl = num(v.band_lo) ?? lo;
  const bh = num(v.band_hi) ?? hi;
  const mid = num(v.median);
  const has = lo !== null && hi !== null;
  const span = has ? hi! - lo! : 0;
  const pos = (x: number) => (has && span > 0 ? ((x - lo!) / span) * 100 : 50);
  const outliers = has && (bl !== lo || bh !== hi);

  return (
    <div className="cov-var">
      <div className="cov-var__head">
        <b>{t(LABEL_KEY[v.key] || v.label)}</b>
        <span className="spacer" />
        <span className="small muted">
          {fmt(v.n)} {t("measurements")} · {fmt(v.documents)} {t("documents")}
        </span>
      </div>

      {has ? (
        <>
          <div className="cov-track" role="img" aria-label={`${bl}-${bh} ${v.unit}`}>
            <div className="cov-extent" style={{ left: `${pos(lo!)}%`, right: `${100 - pos(hi!)}%` }} />
            {bl !== null && bh !== null && (
              <div className="cov-band" style={{ left: `${pos(bl)}%`, right: `${100 - pos(bh)}%` }} />
            )}
            {mid !== null && <div className="cov-median" style={{ left: `${pos(mid)}%` }} />}
          </div>
          <div className="cov-scale small muted">
            <span>
              {fmt(bl)} {v.unit}
            </span>
            <span>
              {t("median")} {fmt(mid)} {v.unit}
            </span>
            <span>
              {fmt(bh)} {v.unit}
            </span>
          </div>
          {outliers && (
            <div className="small muted" style={{ marginTop: 6 }}>
              {t("full extent")}: {fmt(lo)}-{fmt(hi)} {v.unit}
            </div>
          )}
        </>
      ) : (
        <Empty icon="info">{t("No measurements for this variable")}</Empty>
      )}

      <div className="cov-caveat small">
        <Icon name="alert" size={14} />
        <span>{t("machine-extracted, not hand-verified")}</span>
        {v.role ? <span className="muted"> · {t("role")}: {roleT[0] || v.role}</span> : null}
      </div>
      {v.key === "gravity" ? (
        <div className="cov-caveat small">
          <Icon name="info" size={14} />
          <span>
            {t(
              "Platform condition only. PSI holds no direct partial-gravity combustion data, so this is not evidence of lunar or Martian coverage.",
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The differentiator: ask whether a scenario is inside the tested envelope, and
 *  answer with an explicit evidence-gap statement rather than a prediction. */
function ScenarioCheck({ variables }: { variables: Variable[] }) {
  const { t } = useI18n();
  const [o2, setO2] = useState("30");
  const [checked, setChecked] = useState(false);

  const oxygen = useMemo(() => variables.find((v) => v.key === "oxygen") ?? null, [variables]);
  const target = num(o2);
  const lo = oxygen ? num(oxygen.band_lo) ?? num(oxygen.min) : null;
  const hi = oxygen ? num(oxygen.band_hi) ?? num(oxygen.max) : null;
  const inRange = target !== null && lo !== null && hi !== null && target >= lo && target <= hi;

  return (
    <Panel title={t("Check a scenario against the data")} sub={t("does the corpus cover it?")}>
      <div style={{ padding: "14px 18px 18px" }}>
        <div className="hstack wrap" style={{ gap: 10, alignItems: "flex-end" }}>
          <label className="field" style={{ maxWidth: 200 }}>
            <span>{t("Oxygen %")}</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              value={o2}
              onChange={(e) => {
                setO2(e.target.value);
                setChecked(false);
              }}
            />
          </label>
          <button className="btn" type="button" onClick={() => setChecked(true)}>
            {t("Check")}
          </button>
        </div>

        {checked && (
          <div className={`cov-verdict ${inRange ? "in" : "out"}`} style={{ marginTop: 14 }}>
            <span className="cov-verdict__badge">
              <Icon name={inRange ? "check" : "alert"} size={16} />
              {inRange ? t("Within tested range") : t("Outside tested range")}
            </span>
            {inRange ? (
              <p>
                {t("The corpus has measurements around")} {fmt(target)}% O₂.{" "}
                {t("This shows what was tested, not a predicted fire risk.")}
              </p>
            ) : (
              <p>
                {t("No direct measurement in this corpus covers")} {fmt(target)}% O₂.{" "}
                {lo !== null && hi !== null
                  ? `${t("Closest tested oxygen range")}: ${fmt(lo)}-${fmt(hi)}%.`
                  : ""}{" "}
                {t("This is an evidence gap, not a result.")}
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function Coverage() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useApi<CoverageResponse>("/api/coverage");

  const variables = data?.variables ?? [];

  return (
    <AppShell subtitle={t("Coverage & Gaps")}>
      <PageHead title={t("Coverage & Gaps")} sub={t("What the corpus does and does not cover")} />

      <div className="cov-note">
        <Icon name="info" size={16} />
        <span>
          {t(
            data?.note ||
              "Empirical envelope of machine-extracted candidate measurements. Not hand-verified; absence of a value is not evidence of absence.",
          )}
        </span>
      </div>

      {loading ? (
        <Panel>
          <Skeleton rows={5} />
        </Panel>
      ) : error ? (
        <Panel>
          <LoadError message={`${t("Could not reach the coverage service")}. ${error}`} onRetry={reload} />
        </Panel>
      ) : (
        <>
          <Panel title={t("Tested range per variable")} sub={t("empirical envelope of the corpus")}>
            {variables.length ? (
              <div className="cov-grid">
                {variables.map((v) => (
                  <Band key={v.key} v={v} />
                ))}
              </div>
            ) : (
              <Empty icon="shield">{t("No coverage data")}</Empty>
            )}
          </Panel>

          <ScenarioCheck variables={variables} />
        </>
      )}
    </AppShell>
  );
}
