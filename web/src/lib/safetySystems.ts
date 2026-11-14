/**
 * Fire-safety systems map.
 *
 * The challenge asks for three things the rest of LAVA does not cover head-on:
 * point at the work that informs the *next generation* of fire-safety controls
 * and equipment, name the *hardware* the investigations shared, and say what
 * the microgravity work transfers to fire safety *on Earth*. This module is the
 * curated, documented map behind that page.
 *
 * Everything here is a hand-checkable statement about NASA's published work,
 * not a measurement read out of a table. Where a claim comes from the challenge
 * brief rather than the NTRS corpus it is tagged `source: "brief"` so the two
 * are never blurred. Every corpus claim carries an NTRS source id a judge can
 * open. Pure data, so it is unit-tested without a browser.
 */

/** A checkable NTRS document reference. */
export interface Citation {
  sourceId: string;
  title: string;
}

/** Build the public landing URL for a NTRS source id. */
export function ntrs(sourceId: string): string {
  return `https://ntrs.nasa.gov/citations/${sourceId}`;
}

/** The three strategies NASA's spacecraft fire-safety work is organised around. */
export type PillarKey = "prevention" | "detection" | "suppression";

export interface Pillar {
  key: PillarKey;
  title: string;
  /** What the strategy is, in one line. */
  what: string;
  /** What the corpus actually holds on it. */
  corpus: string;
  /** The next-generation control or equipment the research informs. */
  informs: string;
  /** Investigations the corpus ties to this strategy. */
  investigations: PillarInvestigation[];
  citations: Citation[];
}

export const PILLARS: Pillar[] = [
  {
    key: "prevention",
    title: "Prevention",
    what: "Control ignition sources and choose materials whose flammability limits are known.",
    corpus:
      "Solid-fuel ignition and extinction limits at varied pressure (SoFIE), solid burning and suppression in forced flow (BASS, BASS-II), and flame spread in exploration atmospheres as pressure, oxygen and velocity change.",
    informs:
      "Material-selection standards and the limiting-oxygen criteria a lunar base or rover atmosphere has to respect.",
    investigations: [
      { code: "SoFIE" },
      { code: "BASS" },
      { code: "BASS-II" },
      { code: "SPICE", psiId: "PSI-107" },
    ],
    citations: [
      { sourceId: "20200000361", title: "Solid Fuel Ignition and Extinction (SoFIE) Project on ISS" },
      {
        sourceId: "20080034883",
        title:
          "Microgravity Flame Spread in Exploration Atmospheres: Pressure, Oxygen, and Velocity Effects on Opposed and Concurrent Flame Spread",
      },
      {
        sourceId: "20130012832",
        title:
          "Flammability Aspects of a Cotton-Fiberglass Fabric in Opposed and Concurrent Airflow in Microgravity",
      },
    ],
  },
  {
    key: "detection",
    title: "Detection",
    what: "Sense a fire in its earliest phase, before it is a flame.",
    corpus:
      "Smoke particle size and optical properties from overheated spacecraft materials (SAME, SAME-R), and the DAFT tests that reused a SAME detector to size dust, the false-alarm case a detector must reject.",
    informs:
      "Smoke-detector design and false-alarm reduction - the sensor side of a next-generation detection system.",
    investigations: [{ code: "SAME" }, { code: "DAFT-2", psiId: "PSI-47" }],
    citations: [
      {
        sourceId: "20000120278",
        title: "Progress in Fire Detection and Suppression Technology for Future Space Missions",
      },
      {
        sourceId: "20070031686",
        title: "Particle and Smoke Detection on ISS for Next Generation Smoke Detectors",
      },
      {
        sourceId: "20010074094",
        title: "SMOKE: Characterization of Smoke Particulate for Spacecraft Fire Detection",
      },
    ],
  },
  {
    key: "suppression",
    title: "Suppression",
    what: "Extinguish or hold back a fire once it has started.",
    corpus:
      "Droplet extinction and suppression by diluting the chamber with carbon dioxide and helium (FLEX, FLEX-2), and suppression limits of solid fuels in forced flow (BASS, BASS-II).",
    informs:
      "Suppressant selection and the agent-delivery equipment a crew would actually carry - including the fine-water-mist extinguishers developed for the ISS.",
    investigations: [{ code: "FLEX-2" }, { code: "BASS-II" }, { code: "CFI" }],
    citations: [
      {
        sourceId: "19930015566",
        title: "Contributions of Microgravity Test Results to the Design of Spacecraft Fire Safety Systems",
      },
      {
        sourceId: "19880010969",
        title: "Spacecraft Fire-Safety Experiments for Space Station: Technology Development Mission",
      },
      {
        sourceId: "20050215409",
        title: "Combustion Module-2 Achieved Scientific Success on Shuttle Mission STS-107",
      },
    ],
  },
];

/** One investigation and the PSI record it is loaded from, if it has one. */
export interface HardwareInvestigation {
  code: string;
  /** The PSI investigation id, when LAVA loads its measured tables. */
  psiId?: string;
  note: string;
}

/** A strategy's investigation reference: a code, and its PSI id when the
 *  investigation lives only in PSI rather than as a corpus experiment. */
export interface PillarInvestigation {
  code: string;
  psiId?: string;
}

/**
 * Corpus experiment codes that exist as rows in the `experiment` table, so the
 * Experiments page can open them. Anything named in the map that is not here
 * exists only in the PSI measured tables and links to psi.nasa.gov instead.
 */
const CORPUS_EXPERIMENTS = new Set([
  "SAME",
  "SAFFIRE",
  "BASS",
  "BASS-II",
  "ACME",
  "SoFIE",
  "FLEX",
  "FLEX-2",
  "CFI",
  "BRE",
]);

/** Where a named investigation should link: its corpus page, or its PSI record. */
export function investigationHref(inv: PillarInvestigation): { to: string; external: boolean } {
  if (CORPUS_EXPERIMENTS.has(inv.code)) {
    return { to: `/experiments?code=${encodeURIComponent(inv.code)}`, external: false };
  }
  if (inv.psiId) {
    return {
      to: `https://psi.nasa.gov/physci/repo/data/investigations/${inv.psiId}`,
      external: true,
    };
  }
  return { to: `/experiments?code=${encodeURIComponent(inv.code)}`, external: false };
}

/** A shared hardware set the challenge calls out, and what ran on it. */
export interface HardwareGroup {
  facility: string;
  /** Where the hardware lived. */
  rack: string;
  /** The fuel class the hardware was built for. */
  fuels: string;
  investigations: HardwareInvestigation[];
}

export const HARDWARE_GROUPS: HardwareGroup[] = [
  {
    facility: "ACME",
    rack: "Combustion Integrated Rack (CIR)",
    fuels: "Gaseous fuels, one modular set of hardware",
    investigations: [
      { code: "BRE", psiId: "PSI-20", note: "Burning Rate Emulator: gaseous-fuel emulation of materials burning." },
      { code: "E-FIELD", psiId: "PSI-22", note: "Electric-field body force on flame ions, a partial-gravity analogue." },
      { code: "CFI-G", psiId: "PSI-159", note: "Cool flames with gases; the highest-oxygen microgravity tests." },
      { code: "Flame Design", psiId: "PSI-10", note: "Soot and flame-shape control for gaseous fuels." },
    ],
  },
  {
    facility: "MDCA",
    rack: "Multi-user Droplet Combustion Apparatus (CIR)",
    fuels: "Liquid fuels as burning droplets",
    investigations: [
      { code: "FLEX", psiId: "PSI-69", note: "Droplet burning and radiative extinction." },
      { code: "FLEX-2", psiId: "PSI-68", note: "Droplet extinction and suppression by CO2/He dilution." },
      { code: "CFI", psiId: "PSI-39", note: "Low-temperature cool-flame transitions of droplets." },
    ],
  },
  {
    facility: "MSG flow duct",
    rack: "Microgravity Science Glovebox (MSG)",
    fuels: "Solid samples and gaseous fuels in a fan-driven flow duct",
    investigations: [
      { code: "BASS", psiId: "PSI-26", note: "Solid-fuel burning and suppression in forced flow." },
      { code: "BASS-II", psiId: "PSI-25", note: "BASS extended to wider flow and atmosphere ranges." },
      { code: "SPICE", psiId: "PSI-107", note: "Smoke-point limits in co-flow." },
      { code: "SLICE", psiId: "PSI-106", note: "Flame structure and liftoff in co-flow." },
    ],
  },
  {
    facility: "SAFFIRE",
    rack: "Cygnus cargo vehicle (uncrewed, in orbit)",
    fuels: "Large SIBAL fabric panels, spacecraft scale",
    investigations: [
      { code: "SAFFIRE-I", psiId: "PSI-98", note: "First large-scale in-space fire experiment." },
      { code: "SAFFIRE-II", psiId: "PSI-99", note: "Surface combustion over larger samples." },
      { code: "SAFFIRE-III", psiId: "PSI-100", note: "Continued large-scale flame growth and smoke spread." },
    ],
  },
];

/** A measurement type and the instrument class that produces it. */
export interface SensorRow {
  /** What is measured. */
  measurement: string;
  /** The dataset metric key this maps to, when one exists in the corpus. */
  metric?: string;
  /** The instrument class. */
  instruments: string;
  /** Campaigns that used it. */
  campaigns: string[];
}

export const SENSORS: SensorRow[] = [
  {
    measurement: "Smoke / aerosol particle size",
    metric: "smoke_particle_size",
    instruments: "Aerosol spectrometers and particle sizers",
    campaigns: ["SAME", "SAME-R", "DAFT-2"],
  },
  {
    measurement: "Soot volume fraction",
    metric: "soot_volume_fraction",
    instruments: "Laser extinction and optical diagnostics",
    campaigns: ["FLEX-2", "ACME", "SPICE"],
  },
  {
    measurement: "Flame temperature",
    metric: "flame_temperature",
    instruments: "Thermocouples and radiometers",
    campaigns: ["BASS", "BASS-II", "FLEX-2"],
  },
  {
    measurement: "Droplet diameter",
    metric: "droplet_diameter",
    instruments: "Backlit imaging and photometry",
    campaigns: ["FLEX", "FLEX-2", "CFI"],
  },
  {
    measurement: "Oxygen concentration",
    metric: "oxygen_concentration",
    instruments: "Chamber gas analysers",
    campaigns: ["BASS-II", "CFI-G", "SAFFIRE"],
  },
  {
    measurement: "Pressure",
    metric: "pressure",
    instruments: "Chamber pressure transducers",
    campaigns: ["FLEX-2", "SoFIE", "SAFFIRE"],
  },
  {
    measurement: "Flow velocity",
    metric: "flow_velocity",
    instruments: "Flow-duct anemometry",
    campaigns: ["BASS", "BASS-II", "SPICE", "SLICE"],
  },
];

/** Where a claim about an Earth application comes from. */
export type ApplicationSource = "brief" | "corpus";

export interface EarthApplication {
  title: string;
  /** What the microgravity work led to on the ground. */
  detail: string;
  /** The line of work it came out of. */
  origin: string;
  source: ApplicationSource;
  citation?: Citation;
}

export const EARTH_APPLICATIONS: EarthApplication[] = [
  {
    title: "Fine-water-mist extinguishers",
    detail:
      "Extinguishers developed for use on the ISS use a fine water mist that cools and displaces oxygen with far less water than a conventional sprinkler, which carries directly to terrestrial firefighting.",
    origin: "ISS fire suppression",
    source: "brief",
  },
  {
    title: "Smoke detection and false-alarm reduction",
    detail:
      "Spacecraft detectors must not trip on dust, so the SAME and DAFT work on particle size and optical properties sharpens how a detector tells smoke from a nuisance aerosol.",
    origin: "SAME / SAME-R / DAFT",
    source: "corpus",
    citation: {
      sourceId: "20070031686",
      title: "Particle and Smoke Detection on ISS for Next Generation Smoke Detectors",
    },
  },
  {
    title: "Firefighter protective clothing and air tanks",
    detail:
      "Materials and life-support technology developed for spacecraft and crew protection have been adapted into firefighter gear, including protective clothing and breathing apparatus.",
    origin: "Spacecraft materials and life support",
    source: "brief",
  },
  {
    title: "Flammability limits for confined spaces",
    detail:
      "The limiting-oxygen and flame-spread work is the same physics that governs a fire in a sealed room, a submarine or a mine, so the tested envelopes bound confined-space fire risk on the ground too.",
    origin: "Flammability-limit research",
    source: "corpus",
    citation: {
      sourceId: "19930015566",
      title: "Contributions of Microgravity Test Results to the Design of Spacecraft Fire Safety Systems",
    },
  },
];

/** Investigations named across the systems map, de-duplicated and ordered. */
export function mappedInvestigations(): string[] {
  const seen = new Set<string>();
  for (const p of PILLARS) for (const inv of p.investigations) seen.add(inv.code);
  return [...seen];
}

/** Every citation in the map, de-duplicated by source id. */
export function allCitations(): Citation[] {
  const byId = new Map<string, Citation>();
  for (const p of PILLARS) for (const c of p.citations) byId.set(c.sourceId, c);
  for (const a of EARTH_APPLICATIONS) if (a.citation) byId.set(a.citation.sourceId, a.citation);
  return [...byId.values()];
}
