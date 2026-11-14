/**
 * Predictive-modeling map.
 *
 * The challenge's second objective asks for data that supports *predictive
 * modeling of flammability and fire scenarios*. LAVA deliberately refuses to
 * print a fire-risk number it cannot defend, so this module does the honest
 * version of that objective instead: it names the model families the corpus can
 * calibrate and validate, the measured inputs each one needs, and the physical
 * quantity it predicts - then states plainly where the data stops.
 *
 * Every investigation entry is a hand-checkable statement about NASA's
 * published work. Sample geometry and size are described at the level the
 * corpus or the challenge brief documents; exact dimensions live in the PSI
 * tables and the NTRS full text, not asserted here. Anything taken from the
 * brief rather than the corpus is tagged so the two are never blurred. Pure
 * data, so it is unit-tested without a browser.
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

/** How a burning sample is physically shaped - the "shape and size" dimension. */
export type FuelForm = "solid" | "droplet" | "gas";

/** The scale of a test rig, from a single sample to a full spacecraft panel. */
export type TestScale = "small sample" | "bench" | "large-scale";

/**
 * One investigation's tested envelope: what burned, in what shape, and which
 * condition variables actually changed between its tests. `varied` is the part
 * the challenge asks for explicitly - how tests inside one investigation differ.
 */
export interface Envelope {
  code: string;
  name: string;
  campaign: string;
  facility: string;
  scale: TestScale;
  form: FuelForm;
  /** The fuel, as the corpus names it. */
  fuel: string;
  /** The physical shape of the sample or burner. */
  geometry: string;
  /** Sample size, where the corpus or brief documents it; null when it does not. */
  size: string | null;
  /** Condition variables that changed between tests in this investigation. */
  varied: string[];
  /** Condition variables held constant across its tests. */
  fixed: string[];
  citations: Citation[];
}

export const ENVELOPES: Envelope[] = [
  {
    code: "BASS-II",
    name: "Burning and Suppression of Solids - II",
    campaign: "BASS",
    facility: "MSG flow duct",
    scale: "small sample",
    form: "solid",
    fuel: "PMMA rods; cotton-fiberglass (SIBAL) fabric",
    geometry: "Rod and flat sheet in a fan-driven flow duct",
    size: null,
    varied: ["oxygen concentration", "flow velocity", "pressure", "fuel thickness"],
    fixed: ["gravity (microgravity)", "ignition method"],
    citations: [
      { sourceId: "20160000593", title: "Combustion of Solids in Microgravity: Results from the BASS-II Experiment" },
      { sourceId: "20150008961", title: "Microgravity Flammability of PMMA Rods in Concurrent Flow" },
    ],
  },
  {
    code: "BASS",
    name: "Burning and Suppression of Solids",
    campaign: "BASS",
    facility: "MSG flow duct",
    scale: "small sample",
    form: "solid",
    fuel: "PMMA rods; cotton-fiberglass fabric",
    geometry: "Rod and flat sheet in opposed and concurrent flow",
    size: null,
    varied: ["oxygen concentration", "flow velocity", "flow direction"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20150008962", title: "Concurrent Flame Growth, Spread and Extinction over Composite Fabric Samples" },
      { sourceId: "20170006615", title: "Mixed Convection Blowoff Limits as a Function of Oxygen Concentration" },
    ],
  },
  {
    code: "SoFIE",
    name: "Solid Fuel Ignition and Extinction",
    campaign: "SoFIE",
    facility: "CIR",
    scale: "small sample",
    form: "solid",
    fuel: "PMMA; cotton",
    geometry: "Flat solid samples, incl. inclined orientation",
    size: null,
    varied: ["pressure", "oxygen concentration", "sample inclination"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20200000361", title: "Solid Fuel Ignition and Extinction (SoFIE) Project on ISS" },
    ],
  },
  {
    code: "SAFFIRE",
    name: "Spacecraft Fire Safety Experiment",
    campaign: "SAFFIRE",
    facility: "Cygnus (uncrewed)",
    scale: "large-scale",
    form: "solid",
    fuel: "SIBAL (cotton-fiberglass) fabric panel",
    geometry: "Large flat panel, spacecraft-scale",
    size: "~0.9 m2 panel (corpus metadata)",
    varied: ["flow velocity", "panel size"],
    fixed: ["cabin-like atmosphere (~21% O2, ~1 atm)"],
    citations: [
      { sourceId: "20220002714", title: "Model Development of Large-Scale Spacecraft Fires During the Saffire-I Investigation" },
      { sourceId: "20170008805", title: "Results of Large-Scale Spacecraft Flammability Tests" },
    ],
  },
  {
    code: "FLEX-2",
    name: "Flame Extinguishment Experiment - 2",
    campaign: "FLEX",
    facility: "MDCA in CIR",
    scale: "bench",
    form: "droplet",
    fuel: "heptane; methanol; decane; binary mixtures",
    geometry: "Single and binary fuel droplet on a support fiber",
    size: null,
    varied: ["droplet initial diameter", "ambient oxygen", "diluent gas (He / N2 / CO2)"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20090014812", title: "Multi-User Droplet Combustion Apparatus - Flame Extinguishment Experiment" },
    ],
  },
  {
    code: "CFI",
    name: "Cool Flames Investigation",
    campaign: "CFI",
    facility: "CIR / MDCA",
    scale: "bench",
    form: "gas",
    fuel: "gaseous n-alkanes (CFI-G); liquid droplets",
    geometry: "Porous spherical burner - inside-out diffusion flame",
    size: null,
    varied: ["oxygen concentration (up to 85% O2)", "fuel type", "burner flow"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20210021781", title: "Recent Research on Flames of Gaseous Fuel Aboard the International Space Station" },
    ],
  },
  {
    code: "ACME",
    name: "Advanced Combustion via Microgravity Experiments",
    campaign: "ACME",
    facility: "CIR (ACME modular hardware)",
    scale: "bench",
    form: "gas",
    fuel: "gaseous fuels",
    geometry: "Gas-jet burners; BRE emulates a material surface",
    size: null,
    varied: ["fuel and diluent", "burner flow", "electric-field strength (E-FIELD)"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20140009169", title: "Gaseous Non-Premixed Flame Research Planned for the International Space Station" },
    ],
  },
  {
    code: "SAME",
    name: "Smoke Aerosol Measurement Experiment",
    campaign: "SAME",
    facility: "ISS (MSFC)",
    scale: "small sample",
    form: "solid",
    fuel: "overheated spacecraft materials (wire insulation, silicone, Teflon)",
    geometry: "Thermally degraded material samples, not a burning flame",
    size: null,
    varied: ["material", "overheat temperature"],
    fixed: ["cabin atmosphere"],
    citations: [
      { sourceId: "20070031686", title: "Particle and Smoke Detection on ISS for Next Generation Smoke Detectors" },
      { sourceId: "20010074094", title: "SMOKE: Characterization of Smoke Particulate for Spacecraft Fire Detection" },
    ],
  },
  {
    code: "SAME-R",
    name: "Smoke Aerosol Measurement Experiment - Reflight",
    campaign: "SAME",
    facility: "ISS (MSFC)",
    scale: "small sample",
    form: "solid",
    fuel: "overheated spacecraft materials (wire insulation, silicone, Teflon)",
    geometry: "Thermally degraded material samples, not a burning flame",
    size: null,
    varied: ["material", "overheat temperature", "particle growth time"],
    fixed: ["cabin atmosphere"],
    citations: [
      { sourceId: "20150010172", title: "Particle Morphology Results from the Smoke Aerosol Measurement Experiment-Reflight" },
      { sourceId: "20130000422", title: "Particle Morphology and Size Results from the Smoke Aerosol Measurement Experiment-2" },
    ],
  },
  {
    code: "FLEX",
    name: "Flame Extinguishment Experiment",
    campaign: "FLEX",
    facility: "MDCA in CIR",
    scale: "bench",
    form: "droplet",
    fuel: "heptane; methanol; decane",
    geometry: "Single fuel droplet on a support fiber",
    size: null,
    varied: ["droplet initial diameter", "ambient oxygen", "diluent gas (He / N2 / CO2)"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20090014812", title: "Multi-User Droplet Combustion Apparatus - Flame Extinguishment Experiment" },
      { sourceId: "20120015928", title: "FLEX: A Decisive Step Forward in NASA's Combustion Research Program" },
    ],
  },
  {
    code: "CFI-G",
    name: "Cool Flames Investigation with Gases",
    campaign: "CFI",
    facility: "CIR (ACME modular hardware)",
    scale: "bench",
    form: "gas",
    fuel: "gaseous n-alkanes (e.g. propane) in nitrogen",
    geometry: "Porous spherical burner - inside-out diffusion flame",
    size: null,
    varied: ["oxygen concentration (up to 85% O2)", "fuel type", "burner flow"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20210021781", title: "Recent Research on Flames of Gaseous Fuel Aboard the International Space Station" },
    ],
  },
  {
    code: "BRE",
    name: "Burning Rate Emulator",
    campaign: "ACME",
    facility: "CIR (ACME modular hardware)",
    scale: "bench",
    form: "gas",
    fuel: "gaseous fuels emulating a condensed material",
    geometry: "Gas-jet burner that emulates a material surface in still atmosphere",
    size: null,
    varied: ["fuel and diluent", "burner flow", "material properties emulated"],
    fixed: ["gravity (microgravity)", "still atmosphere (no forced flow)"],
    citations: [
      { sourceId: "20160010073", title: "A Burning Rate Emulator (BRE) for Study in Microgravity" },
      { sourceId: "20170009141", title: "Emulation of Condensed Fuel Flames Using a Burning Rate Emulator (BRE) in Microgravity" },
    ],
  },
  {
    code: "E-FIELD",
    name: "Electric-Field Effects on Laminar Diffusion Flames",
    campaign: "ACME",
    facility: "CIR (ACME modular hardware)",
    scale: "bench",
    form: "gas",
    fuel: "gaseous fuels",
    geometry: "Gas-jet burner in a controlled electric field",
    size: null,
    varied: ["electric-field strength (E-FIELD)", "fuel and diluent", "burner flow"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "30580252934587", title: "Electric-field effects on methane coflow flames aboard the International Space Station (ISS)" },
    ],
  },
  {
    code: "SPICE",
    name: "Smoke Point In Co-flow Experiment",
    campaign: "SPICE",
    facility: "MSG flow duct",
    scale: "small sample",
    form: "gas",
    fuel: "gaseous fuels; solid fuels in co-flow",
    geometry: "Burner and solid sample in a fan-driven co-flow duct",
    size: null,
    varied: ["flow velocity", "oxygen concentration", "fuel type"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20090014827", title: "Smoke Point in Co-flow Experiment" },
    ],
  },
  {
    code: "SLICE",
    name: "Structure & Liftoff In Combustion Experiment",
    campaign: "SLICE",
    facility: "MSG flow duct",
    scale: "small sample",
    form: "gas",
    fuel: "gaseous fuels (e.g. methane)",
    geometry: "Gas-jet burner in a fan-driven flow duct",
    size: null,
    varied: ["flow velocity", "oxygen concentration", "fuel type"],
    fixed: ["gravity (microgravity)"],
    citations: [
      { sourceId: "20140017780", title: "An Experimental and Computational Study on Soot Formation in a Coflow Jet Flame Under Microgravity" },
    ],
  },
];

/** A condition variable a model needs, with the unit and why it matters. */
export interface ModelVariable {
  key: string;
  label: string;
  unit: string;
  why: string;
}

export const MODEL_VARIABLES: ModelVariable[] = [
  {
    key: "fuel",
    label: "Fuel and material",
    unit: "material",
    why: "Burning rate and flammability limits are material properties, so a model is only valid for the fuels it was fitted on.",
  },
  {
    key: "geometry",
    label: "Sample shape and size",
    unit: "shape",
    why: "A rod, a flat sheet and a droplet each have a different burning mode; thickness sets whether a material can sustain spread.",
  },
  {
    key: "oxygen",
    label: "Oxygen concentration",
    unit: "%",
    why: "The single strongest driver of flammability; a lunar base or rover atmosphere raises it above Earth's.",
  },
  {
    key: "pressure",
    label: "Pressure",
    unit: "kPa",
    why: "Sets the oxidiser density and the limiting-oxygen threshold a low-pressure habitat has to respect.",
  },
  {
    key: "flow",
    label: "Flow velocity",
    unit: "cm/s",
    why: "Ventilation changes flame spread from opposed to concurrent and can accelerate growth in microgravity.",
  },
  {
    key: "ignition",
    label: "Ignition source",
    unit: "source",
    why: "A hot wire, a spark and an overheat deposit different energy and seed different flame behaviour.",
  },
];

/** How well the corpus supports a model family. */
export type ModelSupport = "bounded" | "partial" | "gap";

/** A predictive model family the corpus can calibrate or validate. */
export interface ModelFamily {
  key: string;
  name: string;
  /** The predictive question the model answers. */
  question: string;
  /** The quantity a model would predict. */
  target: string;
  /** The measured inputs the corpus supplies for it. */
  inputs: string[];
  /** Investigations whose data calibrate or validate it. */
  evidence: { code: string; note: string }[];
  support: ModelSupport;
  citations: Citation[];
}

export const MODEL_FAMILIES: ModelFamily[] = [
  {
    key: "flame_spread",
    name: "Flame-spread rate",
    question: "How fast does a flame spread over a solid surface at a given oxygen, pressure and flow?",
    target: "Spread rate (cm/s) as a function of opposed or concurrent flow.",
    inputs: ["oxygen concentration", "flow velocity", "pressure", "fuel thickness"],
    evidence: [
      { code: "BASS-II", note: "Opposed and concurrent spread over fabric and PMMA in forced flow." },
      { code: "SAFFIRE", note: "Large-panel spread used to fit and test a growth model." },
    ],
    support: "bounded",
    citations: [
      { sourceId: "20220002714", title: "Model Development of Large-Scale Spacecraft Fires During the Saffire-I Investigation" },
      { sourceId: "20080034883", title: "Microgravity Flame Spread in Exploration Atmospheres: Pressure, Oxygen, and Velocity Effects on Opposed and Concurrent Flame Spread" },
    ],
  },
  {
    key: "extinction_loi",
    name: "Extinction and limiting oxygen",
    question: "Below what oxygen concentration, pressure or flow does a flame stop?",
    target: "Limiting oxygen concentration and blow-off limits.",
    inputs: ["oxygen concentration", "pressure", "flow velocity"],
    evidence: [
      { code: "SoFIE", note: "Ignition and extinction limits of solids at varied pressure." },
      { code: "BASS", note: "Mixed-convection blow-off limits versus oxygen concentration." },
      { code: "SPICE", note: "Smoke-point limits that bound the sooting limit of a co-flow flame." },
    ],
    support: "bounded",
    citations: [
      { sourceId: "20200000361", title: "Solid Fuel Ignition and Extinction (SoFIE) Project on ISS" },
      { sourceId: "20170006615", title: "Mixed Convection Blowoff Limits as a Function of Oxygen Concentration" },
    ],
  },
  {
    key: "droplet_burning",
    name: "Droplet burning rate",
    question: "How fast does a fuel droplet burn, and when does it extinguish?",
    target: "Droplet diameter history and the burning-rate constant (d-squared law).",
    inputs: ["droplet initial diameter", "ambient oxygen", "diluent gas"],
    evidence: [
      { code: "FLEX-2", note: "Single and binary droplet burning, soot and extinction." },
      { code: "CFI", note: "Cool-flame, two-stage burning of droplets and gases." },
    ],
    support: "bounded",
    citations: [
      { sourceId: "20090014812", title: "Multi-User Droplet Combustion Apparatus - Flame Extinguishment Experiment" },
    ],
  },
  {
    key: "smoke_transport",
    name: "Smoke and soot transport",
    question: "What particles does a fire make, and will a detector see them in time?",
    target: "Particle size distribution and optical response of a detector.",
    inputs: ["material", "overheat temperature", "soot volume fraction"],
    evidence: [
      { code: "SAME", note: "Smoke particle size and optical properties from overheated materials." },
      { code: "SAME-R", note: "Reflight particle morphology and growth-time results." },
      { code: "ACME", note: "Soot volume fraction in gaseous flames." },
      { code: "SLICE", note: "Soot formation in a co-flow jet flame under microgravity." },
    ],
    support: "partial",
    citations: [
      { sourceId: "20070031686", title: "Particle and Smoke Detection on ISS for Next Generation Smoke Detectors" },
      { sourceId: "20010074094", title: "SMOKE: Characterization of Smoke Particulate for Spacecraft Fire Detection" },
    ],
  },
  {
    key: "high_o2",
    name: "Elevated-oxygen flammability",
    question: "How much more flammable is a material in a high-oxygen habitat or spacesuit?",
    target: "Flammability limit at raised oxygen and reduced pressure.",
    inputs: ["oxygen concentration (up to 85%)", "pressure", "fuel"],
    evidence: [
      { code: "CFI", note: "CFI-G ran the highest-oxygen microgravity tests, up to 85% O2." },
      { code: "SoFIE", note: "Extinction limits at varied pressure bound the low-pressure side." },
    ],
    support: "partial",
    citations: [
      { sourceId: "20210021781", title: "Recent Research on Flames of Gaseous Fuel Aboard the International Space Station" },
    ],
  },
];

/** A requirement the data does not yet meet, stated as a gap rather than filled in. */
export interface ModelGap {
  key: string;
  title: string;
  detail: string;
}

export const MODEL_GAPS: ModelGap[] = [
  {
    key: "partial_g",
    title: "Partial gravity is unsampled",
    detail:
      "The corpus is microgravity-only. Lunar and Martian gravity sit between microgravity and Earth, and PSI holds no direct partial-gravity combustion data yet, so a habitat or rover model cannot be validated at its own gravity level.",
  },
  {
    key: "high_o2_scale",
    title: "High oxygen at full scale",
    detail:
      "The highest-oxygen tests were small gaseous flames. A lunar base runs a large volume at 30% O2 or more, so the high-oxygen results bound the trend but do not cover a full-scale habitat fire.",
  },
  {
    key: "verification",
    title: "Extracted numbers are candidates",
    detail:
      "The condition values this page reasons over are machine-extracted from the papers. They are candidates for a human to check, not verified measurements, so a model fitted on them must carry that caveat.",
  },
];
