import { useState } from "react";

import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { PageHead, Panel, Stat } from "../../components/Page";
import { useI18n } from "../../lib/i18n/provider";
import {
  ENVELOPES,
  MODEL_FAMILIES,
  MODEL_GAPS,
  MODEL_VARIABLES,
  ntrs,
  type ModelSupport,
} from "../../lib/modeling";

const SUPPORT_LABEL: Record<ModelSupport, string> = {
  bounded: "Bounded by data",
  partial: "Partly bounded",
  gap: "Evidence gap",
};

const SUPPORT_CLASS: Record<ModelSupport, string> = {
  bounded: "ok",
  partial: "warn",
  gap: "miss",
};

/** One model family: the question, the predicted quantity, the inputs the
 *  corpus supplies, and the investigations that calibrate it. */
function FamilyCard({ family }: { family: (typeof MODEL_FAMILIES)[number] }) {
  const { t } = useI18n();
  return (
    <article className="pm-family card">
      <div className="card-top">
        <b>{t(family.name)}</b>
        <span className={`pm-badge pm-badge--${SUPPORT_CLASS[family.support]}`}>
          {t(SUPPORT_LABEL[family.support])}
        </span>
      </div>
      <p className="small" style={{ margin: "0 0 10px" }}>{t(family.question)}</p>
      <div className="fs-field">
        <span className="fs-field__k">{t("Predicts")}</span>
        <p className="small muted">{t(family.target)}</p>
      </div>
      <div className="fs-field">
        <span className="fs-field__k">{t("Measured inputs")}</span>
        <div className="pm-chips">
          {family.inputs.map((i) => (
            <span key={i} className="pm-chip small">{t(i)}</span>
          ))}
        </div>
      </div>
      <div className="fs-field">
        <span className="fs-field__k">{t("Calibrating investigations")}</span>
        <ul className="pm-ev">
          {family.evidence.map((ev) => (
            <li key={ev.code}>
              <b>{ev.code}</b> <span className="muted small">{t(ev.note)}</span>
            </li>
          ))}
        </ul>
      </div>
      {family.citations.length > 0 && (
        <div className="fs-cites">
          {family.citations.map((c) => (
            <a key={c.sourceId} className="doc-link small" href={ntrs(c.sourceId)} target="_blank" rel="noreferrer">
              {t(c.title)}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

/** One investigation's tested envelope: what burned, in what shape, and which
 *  conditions actually changed between its tests. */
function EnvelopeCard({ env }: { env: (typeof ENVELOPES)[number] }) {
  const { t } = useI18n();
  return (
    <article className="pm-env card">
      <div className="card-top">
        <b>{env.code}</b>
        <span className="pm-badge pm-badge--soft">{t(env.scale)}</span>
      </div>
      <p className="small muted" style={{ margin: "0 0 10px" }}>{t(env.name)}</p>
      <dl className="dl dl--tight">
        <dt>{t("Fuel")}</dt>
        <dd>{t(env.fuel)}</dd>
        <dt>{t("Shape")}</dt>
        <dd>{t(env.geometry)}</dd>
        <dt>{t("Size")}</dt>
        <dd>{env.size ? t(env.size) : <span className="muted">{t("not documented in the corpus")}</span>}</dd>
        <dt>{t("Facility")}</dt>
        <dd>{env.facility}</dd>
      </dl>
      <div className="fs-field">
        <span className="fs-field__k">{t("Varied between its tests")}</span>
        <div className="pm-chips">
          {env.varied.map((v) => (
            <span key={v} className="pm-chip pm-chip--var small">{t(v)}</span>
          ))}
        </div>
      </div>
      <div className="fs-field">
        <span className="fs-field__k">{t("Held constant")}</span>
        <div className="pm-chips">
          {env.fixed.map((v) => (
            <span key={v} className="pm-chip small">{t(v)}</span>
          ))}
        </div>
      </div>
      <div className="fs-cites">
        {env.citations.map((c) => (
          <a key={c.sourceId} className="doc-link small" href={ntrs(c.sourceId)} target="_blank" rel="noreferrer">
            {t(c.title)}
          </a>
        ))}
      </div>
    </article>
  );
}

export default function Modeling() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"families" | "envelopes">("families");

  const bounded = MODEL_FAMILIES.filter((m) => m.support === "bounded").length;

  return (
    <AppShell subtitle={t("Predictive Modeling")}>
      <PageHead
        title={t("Predictive Modeling")}
        sub={t("the measured inputs a flammability model needs, and where the data stops")}
      />

      <div className="cov-note">
        <Icon name="info" size={16} />
        <span>
          {t(
            "This page does not predict a fire risk. It names the model families the corpus can calibrate, the measured inputs each one needs, and the physical quantity it predicts - then states where the data runs out. Every number stays a candidate for a human to check.",
          )}
        </span>
      </div>

      <div className="stat-row">
        <Stat label={t("Model families")} value={MODEL_FAMILIES.length} count={false} />
        <Stat label={t("Bounded by data")} value={bounded} count={false} />
        <Stat label={t("Inputs a model needs")} value={MODEL_VARIABLES.length} count={false} />
        <Stat label={t("Tested envelopes")} value={ENVELOPES.length} count={false} />
      </div>

      <Panel title={t("What a model needs")} sub={t("the measured inputs, and why each one matters")}>
        <div className="pm-vars">
          {MODEL_VARIABLES.map((v) => (
            <div key={v.key} className="pm-var">
              <div className="pm-var__k">
                {t(v.label)} <span className="mono muted small">{v.unit}</span>
              </div>
              <p className="small muted" style={{ margin: 0 }}>{t(v.why)}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={t("Model families and their evidence")}
        sub={t("what the corpus can calibrate or validate")}
        actions={
          <div className="hstack" style={{ gap: 8 }}>
            <button
              type="button"
              className={`chip${tab === "families" ? " on" : ""}`}
              onClick={() => setTab("families")}
            >
              {t("Model families")}
            </button>
            <button
              type="button"
              className={`chip${tab === "envelopes" ? " on" : ""}`}
              onClick={() => setTab("envelopes")}
            >
              {t("Tested envelopes")}
            </button>
          </div>
        }
      >
        {tab === "families" ? (
          <div className="pm-grid">
            {MODEL_FAMILIES.map((m) => (
              <FamilyCard key={m.key} family={m} />
            ))}
          </div>
        ) : (
          <div className="pm-grid">
            {ENVELOPES.map((e) => (
              <EnvelopeCard key={e.code} env={e} />
            ))}
          </div>
        )}
      </Panel>

      <Panel title={t("Where the data stops")} sub={t("stated as a gap, never filled with a guess")}>
        <div className="pm-gaps">
          {MODEL_GAPS.map((g) => (
            <div key={g.key} className="pm-gap">
              <div className="pm-gap__t">
                <Icon name="alert" size={16} />
                <b>{t(g.title)}</b>
              </div>
              <p className="small muted" style={{ margin: "4px 0 0" }}>{t(g.detail)}</p>
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
