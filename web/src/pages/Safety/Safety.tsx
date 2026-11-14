import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { PageHead, Panel, Stat } from "../../components/Page";
import { fmt } from "../../lib/format";
import { useI18n } from "../../lib/i18n/provider";
import {
  EARTH_APPLICATIONS,
  HARDWARE_GROUPS,
  investigationHref,
  mappedInvestigations,
  ntrs,
  PILLARS,
  type PillarKey,
  SENSORS,
} from "../../lib/safetySystems";

const PILLAR_LABEL: Record<PillarKey, string> = {
  prevention: "Prevention",
  detection: "Detection",
  suppression: "Suppression",
};

const PILLAR_ICON: Record<PillarKey, string> = {
  prevention: "shield",
  detection: "activity",
  suppression: "bolt",
};

/** One strategy: what it is, what the corpus holds, and what it informs. */
function PillarCard({ pillar }: { pillar: (typeof PILLARS)[number] }) {
  const { t } = useI18n();
  return (
    <article className="fs-pillar card">
      <div className="card-top">
        <Icon name={PILLAR_ICON[pillar.key]} size={18} />
        <b>{t(PILLAR_LABEL[pillar.key])}</b>
      </div>
      <p className="small" style={{ margin: "0 0 8px" }}>{t(pillar.what)}</p>
      <div className="fs-field">
        <span className="fs-field__k">{t("Corpus evidence")}</span>
        <p className="small muted">{t(pillar.corpus)}</p>
      </div>
      <div className="fs-field">
        <span className="fs-field__k">{t("Informs next-generation controls")}</span>
        <p className="small">{t(pillar.informs)}</p>
      </div>
      <div className="meta wrap" style={{ marginTop: 4 }}>
        {pillar.investigations.map((inv) => {
          const href = investigationHref(inv);
          return href.external ? (
            <a key={inv.code} className="cite" href={href.to} target="_blank" rel="noreferrer">
              {inv.code}
            </a>
          ) : (
            <Link key={inv.code} className="cite" to={href.to}>
              {inv.code}
            </Link>
          );
        })}
      </div>
      <div className="fs-cites">
        {pillar.citations.map((c) => (
          <a key={c.sourceId} className="doc-link small" href={ntrs(c.sourceId)} target="_blank" rel="noreferrer">
            {t(c.title)}
          </a>
        ))}
      </div>
    </article>
  );
}

/** One shared hardware set and the investigations that ran on it. */
function HardwareCard({ group }: { group: (typeof HARDWARE_GROUPS)[number] }) {
  const { t } = useI18n();
  return (
    <article className="fs-hw card">
      <div className="fs-hw__head">
        <b>{group.facility}</b>
        <span className="small muted">{t(group.rack)}</span>
      </div>
      <p className="small muted" style={{ margin: "2px 0 10px" }}>
        {t("Fuel class")}: {t(group.fuels)}
      </p>
      <div className="fs-hw__rows">
        {group.investigations.map((inv) => {
          const href = investigationHref(inv);
          const label = href.external ? inv.psiId ?? inv.code : inv.code;
          return (
            <div key={inv.code} className="fs-hw__row">
              <div className="fs-hw__code">
                {href.external ? (
                  <a href={href.to} target="_blank" rel="noreferrer">
                    {inv.code}
                  </a>
                ) : (
                  <Link to={href.to}>{inv.code}</Link>
                )}
                {href.external && inv.psiId && <span className="fs-psi">{label}</span>}
              </div>
              <p className="small muted">{t(inv.note)}</p>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/** One Earth application, tagged by whether the brief or the corpus backs it. */
function EarthCard({ app }: { app: (typeof EARTH_APPLICATIONS)[number] }) {
  const { t } = useI18n();
  return (
    <article className="fs-earth card">
      <div className="card-top">
        <b className="fs-earth__t">{t(app.title)}</b>
        <span className={`fs-badge fs-badge--${app.source}`}>
          {app.source === "brief" ? t("from the challenge brief") : t("from the corpus")}
        </span>
      </div>
      <p className="small" style={{ margin: "2px 0 8px" }}>{t(app.detail)}</p>
      <div className="meta small muted">
        <span>{t("Origin")}: {t(app.origin)}</span>
      </div>
      {app.citation && (
        <a className="doc-link small" href={ntrs(app.citation.sourceId)} target="_blank" rel="noreferrer">
          {t(app.citation.title)}
        </a>
      )}
    </article>
  );
}

export default function Safety() {
  const { t } = useI18n();
  const [active, setActive] = useState<PillarKey | "all">("all");
  const mapped = useMemo(mappedInvestigations, []);

  const pillars = active === "all" ? PILLARS : PILLARS.filter((p) => p.key === active);

  return (
    <AppShell subtitle={t("Fire Safety Systems")}>
      <PageHead
        title={t("Fire Safety Systems")}
        sub={t("How the corpus informs prevention, detection and suppression - and what transfers to Earth")}
      />

      <div className="cov-note">
        <Icon name="info" size={16} />
        <span>
          {t(
            "A curated map, not a measurement. Each strategy names the investigations behind it and the equipment it informs; every corpus claim links to its NTRS source. Claims taken from the challenge brief, not the corpus, are labelled as such.",
          )}
        </span>
      </div>

      <div className="stat-row">
        <Stat label={t("Strategies")} value={PILLARS.length} count={false} />
        <Stat label={t("Investigations mapped")} value={mapped.length} count={false} />
        <Stat label={t("Hardware sets")} value={HARDWARE_GROUPS.length} count={false} />
        <Stat label={t("Measurement types")} value={SENSORS.length} count={false} />
      </div>

      <Panel title={t("Three strategies")} sub={t("prevention, detection, suppression")}>
        <div className="hstack wrap" style={{ padding: "0 18px 12px", gap: 8 }}>
          <button
            type="button"
            className={`chip${active === "all" ? " on" : ""}`}
            onClick={() => setActive("all")}
          >
            {t("All")}
          </button>
          {PILLARS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`chip${active === p.key ? " on" : ""}`}
              onClick={() => setActive(p.key)}
            >
              {t(PILLAR_LABEL[p.key])}
            </button>
          ))}
        </div>
        <div className="fs-grid">
          {pillars.map((p) => (
            <PillarCard key={p.key} pillar={p} />
          ))}
        </div>
      </Panel>

      <Panel title={t("Shared hardware")} sub={t("the investigations reused one modular set per rack")}>
        <div className="fs-grid">
          {HARDWARE_GROUPS.map((g) => (
            <HardwareCard key={g.facility} group={g} />
          ))}
        </div>
      </Panel>

      <Panel
        title={t("Sensors and measurements")}
        sub={t("what each instrument class records, and where the numbers land")}
      >
        <div className="fs-sensors">
          {SENSORS.map((s) => (
            <div key={s.measurement} className="fs-sensor">
              <div className="fs-sensor__m">
                {s.metric ? (
                  <Link to={`/datasets?key=${encodeURIComponent(s.metric)}`}>{t(s.measurement)}</Link>
                ) : (
                  <span>{t(s.measurement)}</span>
                )}
              </div>
              <div className="fs-sensor__i small muted">{t(s.instruments)}</div>
              <div className="fs-sensor__c small muted">{s.campaigns.join(" · ")}</div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ padding: "0 18px 16px" }}>
          {t(
            "Instrument classes are grouped from the measurement each campaign reports; the linked metric is the dataset the corpus extracts it into.",
          )}
        </p>
      </Panel>

      <Panel title={t("What transfers to Earth")} sub={t("microgravity fire safety that leaves the spacecraft")}>
        <div className="fs-grid">
          {EARTH_APPLICATIONS.map((a) => (
            <EarthCard key={a.title} app={a} />
          ))}
        </div>
      </Panel>

      <Panel title={t("References")} sub={t("every NTRS document this page cites")}>
        <div className="fs-refs">
          {PILLARS.flatMap((p) => p.citations)
            .concat(EARTH_APPLICATIONS.flatMap((a) => (a.citation ? [a.citation] : [])))
            .filter((c, i, arr) => arr.findIndex((x) => x.sourceId === c.sourceId) === i)
            .map((c) => (
              <a key={c.sourceId} className="fs-ref small" href={ntrs(c.sourceId)} target="_blank" rel="noreferrer">
                <span className="mono">{c.sourceId}</span>
                <span>{t(c.title)}</span>
              </a>
            ))}
        </div>
        <p className="small muted" style={{ padding: "0 18px 16px" }}>
          {t("Corpus totals for this map")}: {fmt(mapped.length)} {t("investigations")} ·{" "}
          {fmt(HARDWARE_GROUPS.length)} {t("hardware sets")} · {fmt(SENSORS.length)} {t("measurement types")}.
        </p>
      </Panel>
    </AppShell>
  );
}
