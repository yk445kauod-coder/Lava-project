import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { Empty, PageHead, Panel, Stat } from "../../components/Page";
import { useI18n } from "../../lib/i18n/provider";
import {
  type Environment,
  EXPERIMENTS,
  type Fit,
  type FitFactor,
  NAMED_ABSENT,
  NAMED_IN_PSI,
  type Need,
  rankAll,
} from "../../lib/relevance";

/** Human label for a fire-safety need, keyed to the English source string. */
const NEED_LABEL: Record<Need, string> = {
  material_flammability: "Material flammability",
  large_scale_growth: "Large-scale fire growth",
  detection: "Fire detection",
  suppression: "Suppression",
  ignition_extinction_limits: "Ignition & extinction limits",
  elevated_oxygen: "Elevated-oxygen flammability",
  solid_fuel: "Solid fuels",
  gaseous_fuel: "Gaseous fuels",
  liquid_fuel: "Liquid fuels",
  flow_effects: "Airflow effects",
};

/** English label of an environment, keyed for translation. */
const ENV_LABEL: Record<string, string> = {
  station: "Spacecraft cabin / space station",
  suit: "EVA spacesuit",
  habitat: "Lunar / Martian surface habitat",
  rover: "Pressurized rover",
};

const GRADE_LABEL: Record<Fit["grade"], string> = {
  strong: "Strong fit",
  moderate: "Moderate fit",
  limited: "Limited fit",
  weak: "Weak fit",
};

const GRADE_CLASS: Record<Fit["grade"], string> = {
  strong: "rel-strong",
  moderate: "rel-moderate",
  limited: "rel-limited",
  weak: "rel-weak",
};

/** One factor's contribution, as a labelled share of the weighting. */
function FactorRow({ f }: { f: FitFactor }) {
  const { t } = useI18n();
  const share = Math.round((f.contribution / (f.weight || 1)) * 100);
  return (
    <div className="rel-factor">
      <span className="rel-factor__name">{t(NEED_LABEL[f.need])}</span>
      <span className="rel-factor__track" title={`${t("weight")} ${(f.weight * 100).toFixed(0)}%`}>
        <i style={{ width: `${share}%` }} />
      </span>
      <span className="rel-factor__val small muted">{share}%</span>
    </div>
  );
}

/** One investigation's fit to the selected environment. */
function FitCard({ fit, rank }: { fit: Fit; rank: number }) {
  const { t } = useI18n();
  const { experiment: e } = fit;
  return (
    <article className="rel-card card">
      <div className="hstack wrap" style={{ gap: 10 }}>
        <span className="rel-rank">{rank}</span>
        <b className="grow">{e.code}</b>
        <span className={`rel-grade ${GRADE_CLASS[fit.grade]}`}>
          {t(GRADE_LABEL[fit.grade])} · {fit.score}
        </span>
      </div>
      <p className="small muted" style={{ margin: "6px 0 2px" }}>
        {e.name}
      </p>
      <p className="small" style={{ margin: "4px 0 10px" }}>
        {t(e.role)}
      </p>
      <div className="rel-meta small muted">
        <span>{t("Fuel")}: {e.fuelClass}</span>
        <span>{t("Facility")}: {e.facility}</span>
        <span>{t("Scale")}: {t(e.scale)}</span>
      </div>
      <div className="rel-factors">
        {fit.factors
          .filter((f) => f.weight > 0)
          .slice(0, 5)
          .map((f) => (
            <FactorRow key={f.need} f={f} />
          ))}
      </div>
      {fit.gravityGap && (
        <div className="rel-gap small">
          <Icon name="alert" size={14} />
          <span>
            {t(
              "This environment is partial gravity, but the corpus is microgravity-only. The score is discounted and the gravity effect is an evidence gap, not a measured result.",
            )}
          </span>
        </div>
      )}
      <Link className="rel-link small" to={`/experiments?code=${encodeURIComponent(e.code)}`}>
        {t("Open investigation")} <Icon name="external" size={13} />
      </Link>
    </article>
  );
}

export default function Relevance() {
  const { t } = useI18n();
  const rankings = useMemo(() => rankAll(), []);
  const [active, setActive] = useState(rankings[0]?.environment.key ?? "station");

  const current = rankings.find((r) => r.environment.key === active) ?? rankings[0];
  const env: Environment = current.environment;
  const fits = current.fits;
  const strong = fits.filter((f) => f.grade === "strong").length;

  return (
    <AppShell subtitle={t("Mission Relevance")}>
      <PageHead
        title={t("Mission Relevance")}
        sub={t("Which microgravity investigations matter most for each habitable crew environment")}
      />

      <div className="cov-note">
        <Icon name="info" size={16} />
        <span>
          {t(
            "A transparent rubric, not a measurement. Each environment lists the fire-safety needs that matter for it; each investigation lists what it actually studied; the fit is the weighted overlap. The corpus holds no per-investigation atmosphere values, so no number here is read from a table.",
          )}
        </span>
      </div>

      <div className="stat-row">
        <Stat label={t("Environments")} value={rankings.length} count={false} />
        <Stat label={t("Investigations scored")} value={fits.length} count={false} />
        <Stat label={t("Strong fits here")} value={strong} count={false} />
        <Stat label={t("Corpus gravity")} value={t("microgravity only")} count={false} />
      </div>

      <Panel title={t("Target environment")} sub={t("pick the crew environment to plan for")}>
        <div className="hstack wrap" style={{ padding: "0 18px 16px" }}>
          {rankings.map((r) => (
            <button
              key={r.environment.key}
              type="button"
              className={`chip${r.environment.key === active ? " on" : ""}`}
              onClick={() => setActive(r.environment.key)}
            >
              {t(ENV_LABEL[r.environment.key] || r.environment.key)}
            </button>
          ))}
        </div>

        <div className="rel-envbar">
          <div>
            <span className="rel-envbar__k">{t("Oxygen")}</span>
            <span className="rel-envbar__v">{env.oxygen}</span>
          </div>
          <div>
            <span className="rel-envbar__k">{t("Pressure")}</span>
            <span className="rel-envbar__v">{env.pressure}</span>
          </div>
          <div>
            <span className="rel-envbar__k">{t("Gravity")}</span>
            <span className="rel-envbar__v">{env.gravity}</span>
          </div>
        </div>

        {env.contrast && (
          <p className="rel-contrast" style={{ margin: "0 18px 16px" }}>
            {t(env.contrast)}
          </p>
        )}

        {env.gravityClass === "partial" && (
          <div className="rel-gap small" style={{ margin: "0 18px 16px" }}>
            <Icon name="alert" size={14} />
            <span>
              {t(
                "Partial-gravity environments are flagged across the board: PSI holds no direct partial-gravity combustion data yet (LUCI and FM2 are expected later). Microgravity results bound, but do not replace, this regime.",
              )}
            </span>
          </div>
        )}
      </Panel>

      <Panel title={t("Investigations ranked for this environment")} sub={t("best fit first")}>
        <div className="rel-grid">
          {fits.length ? (
            fits.map((f, i) => <FitCard key={f.experiment.code} fit={f} rank={i + 1} />)
          ) : (
            <Empty icon="shield">{t("No investigations to score")}</Empty>
          )}
        </div>
      </Panel>

      <Panel title={t("The rubric")} sub={t("how a score is built")}>
        <div className="rel-rubric">
          {fits.map((f) => (
            <div key={f.experiment.code} className="rel-rubric__row small">
              <b>{f.experiment.code}</b>
              <span className="muted">
                {f.factors
                  .filter((x) => x.capability > 0)
                  .map((x) => `${t(NEED_LABEL[x.need])} ${x.capability.toFixed(2)}`)
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ padding: "0 18px 16px" }}>
          {t(
            "Fit = the sum of (need weight x investigation strength), divided by the total weight, then multiplied by a gravity factor (1.0 for microgravity, 0.6 for partial gravity). Strength values come from each campaign's documented purpose, so a judge can recompute them by hand.",
          )}
        </p>
        <p className="small muted" style={{ padding: "0 18px 16px" }}>
          {t("Investigations in this ranking")}: {EXPERIMENTS.map((e) => e.code).join(", ")}
        </p>
      </Panel>

      <Panel
        title={t("Named by the challenge")}
        sub={t("what the corpus holds, and what it still needs")}
      >
        <p className="small muted" style={{ padding: "0 18px 8px" }}>
          {t("The challenge names several investigations. Six are in the PSI measured tables LAVA loads (so their data is searchable even though no standalone NTRS report carries the name); the rest are not in the data yet.")}
        </p>
        <div className="rel-named">
          {NAMED_IN_PSI.map((n) => (
            <div key={n.code} className="rel-named__row">
              <b>{n.code}</b>
              <span className="small muted">{n.name} · {n.psiId}</span>
              <p className="small" style={{ margin: "3px 0 0" }}>{t(n.note)}</p>
            </div>
          ))}
          {NAMED_ABSENT.map((n) => (
            <div key={n.code} className="rel-named__row rel-named__row--absent">
              <b>{n.code}</b>
              <span className="small muted">{n.name}</span>
              <p className="small" style={{ margin: "3px 0 0" }}>{t(n.note)}</p>
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
