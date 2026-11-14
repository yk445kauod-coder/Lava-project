/**
 * Mission relevance engine.
 *
 * The challenge's headline objective is to point at the investigations that
 * matter most for the fire-safety needs of a *habitable crew environment* -
 * a spacecraft cabin, a lunar/Martian surface habitat, a pressurized rover, an
 * EVA spacesuit. The corpus, however, is microgravity-only and holds no measured
 * per-investigation atmosphere values, so we cannot read a numeric fit out of
 * the database. Instead we score a *curated, documented* rubric: each
 * environment declares the fire-safety needs that matter for it (with a weight),
 * each experiment declares what it actually studied (with a strength), and the
 * fit is the weighted overlap. Every number the page shows is explainable from
 * the factors below, and the microgravity-only corpus is reported as an explicit
 * gap rather than hidden.
 *
 * Everything here is pure so it can be unit-tested without a browser.
 */

/** The fire-safety needs a rubric can score. */
export type Need =
  | "material_flammability"
  | "large_scale_growth"
  | "detection"
  | "suppression"
  | "ignition_extinction_limits"
  | "elevated_oxygen"
  | "solid_fuel"
  | "gaseous_fuel"
  | "liquid_fuel"
  | "flow_effects";

/** A capability an investigation demonstrated, 0..1. */
export type Capability = Partial<Record<Need, number>>;

export interface Environment {
  key: string;
  /** The atmosphere the environment is designed to hold (from the brief). */
  oxygen: string;
  pressure: string;
  gravity: string;
  /** microgravity data transfers directly; partial-gravity needs a caveat. */
  gravityClass: "micro" | "partial";
  /** The fire-safety needs that matter here, and how much. Weights sum to 1. */
  needs: Partial<Record<Need, number>>;
}

export interface ExperimentProfile {
  code: string;
  name: string;
  campaign: string;
  /** One line on what fire-safety question this investigation answers. */
  role: string;
  fuelClass: string;
  facility: string;
  scale: "small sample" | "bench" | "large-scale";
  capabilities: Capability;
}

/** An investigation the challenge names but the corpus does not yet hold. */
export interface NamedInvestigation {
  code: string;
  name: string;
  /** Why it matters for fire safety, in one line. */
  note: string;
}

/**
 * Target environments. Oxygen and pressure figures are the ones the challenge
 * statement gives, so they can be checked against the source.
 */
export const ENVIRONMENTS: Environment[] = [
  {
    key: "station",
    oxygen: "~21% O2",
    pressure: "~14.7 psi",
    gravity: "microgravity (~1e-6 g)",
    gravityClass: "micro",
    needs: {
      material_flammability: 0.22,
      large_scale_growth: 0.18,
      detection: 0.18,
      suppression: 0.16,
      ignition_extinction_limits: 0.16,
      solid_fuel: 0.1,
    },
  },
  {
    key: "suit",
    oxygen: "100% O2",
    pressure: "4.3 psi",
    gravity: "microgravity (~1e-6 g)",
    gravityClass: "micro",
    needs: {
      elevated_oxygen: 0.28,
      material_flammability: 0.22,
      ignition_extinction_limits: 0.22,
      suppression: 0.14,
      solid_fuel: 0.14,
    },
  },
  {
    key: "habitat",
    oxygen: ">=30% O2",
    pressure: "<=10.2 psi",
    gravity: "partial gravity",
    gravityClass: "partial",
    needs: {
      elevated_oxygen: 0.24,
      material_flammability: 0.22,
      ignition_extinction_limits: 0.2,
      suppression: 0.18,
      solid_fuel: 0.16,
    },
  },
  {
    key: "rover",
    oxygen: ">=30% O2",
    pressure: "<=10.2 psi",
    gravity: "partial gravity",
    gravityClass: "partial",
    needs: {
      elevated_oxygen: 0.24,
      material_flammability: 0.2,
      detection: 0.16,
      suppression: 0.16,
      ignition_extinction_limits: 0.14,
      solid_fuel: 0.1,
    },
  },
];

/**
 * Curated investigation profiles. The strengths are read off each campaign's
 * documented purpose (its objective/summary in the corpus, the hardware notes in
 * the brief), not off a measured table, so treat them as a transparent rubric.
 */
export const EXPERIMENTS: ExperimentProfile[] = [
  {
    code: "SAFFIRE",
    name: "Spacecraft Fire Safety Experiment",
    campaign: "SAFFIRE",
    role: "Large-scale flame growth and smoke spread on spacecraft-scale panels.",
    fuelClass: "SIBAL fabric panels",
    facility: "Cygnus (uncrewed)",
    scale: "large-scale",
    capabilities: {
      large_scale_growth: 0.95,
      material_flammability: 0.6,
      solid_fuel: 0.7,
      detection: 0.5,
      suppression: 0.3,
      elevated_oxygen: 0.1,
    },
  },
  {
    code: "BASS-II",
    name: "Burning and Suppression of Solids - II",
    campaign: "BASS",
    role: "Solid-material flammability and suppression limits in forced flow.",
    fuelClass: "PMMA, SIBAL",
    facility: "MSG flow duct",
    scale: "small sample",
    capabilities: {
      material_flammability: 0.95,
      solid_fuel: 0.9,
      suppression: 0.8,
      flow_effects: 0.8,
      ignition_extinction_limits: 0.6,
      elevated_oxygen: 0.2,
      large_scale_growth: 0.3,
    },
  },
  {
    code: "BASS",
    name: "Burning and Suppression of Solids",
    campaign: "BASS",
    role: "First-generation solid-fuel burning and suppression.",
    fuelClass: "PMMA, SIBAL",
    facility: "MSG flow duct",
    scale: "small sample",
    capabilities: {
      material_flammability: 0.85,
      solid_fuel: 0.85,
      suppression: 0.7,
      flow_effects: 0.6,
      ignition_extinction_limits: 0.5,
      elevated_oxygen: 0.2,
    },
  },
  {
    code: "SoFIE",
    name: "Solid Fuel Ignition and Extinction",
    campaign: "SoFIE",
    role: "Ignition and extinction limits of solid fuels at varied pressure.",
    fuelClass: "PMMA, cotton",
    facility: "ISS",
    scale: "small sample",
    capabilities: {
      ignition_extinction_limits: 0.9,
      material_flammability: 0.7,
      solid_fuel: 0.8,
      elevated_oxygen: 0.4,
    },
  },
  {
    code: "FLEX-2",
    name: "Flame Extinguishment Experiment - 2",
    campaign: "FLEX",
    role: "Droplet extinction limits and suppression by CO2/He dilution.",
    fuelClass: "heptane, methanol, decane",
    facility: "MDCA in CIR",
    scale: "bench",
    capabilities: {
      suppression: 0.85,
      liquid_fuel: 0.9,
      ignition_extinction_limits: 0.7,
      material_flammability: 0.2,
    },
  },
  {
    code: "SAME",
    name: "Smoke Aerosol Measurement Experiment",
    campaign: "SAME",
    role: "Smoke particle size and optical properties for fire detection.",
    fuelClass: "overheated spacecraft materials",
    facility: "ISS",
    scale: "small sample",
    capabilities: {
      detection: 0.95,
      solid_fuel: 0.3,
      material_flammability: 0.15,
    },
  },
  {
    code: "ACME",
    name: "Advanced Combustion via Microgravity Experiments",
    campaign: "ACME",
    role: "Gaseous-fuel flammability fundamentals; BRE emulates materials burning.",
    fuelClass: "gaseous fuels",
    facility: "CIR",
    scale: "bench",
    capabilities: {
      gaseous_fuel: 0.9,
      material_flammability: 0.6,
      ignition_extinction_limits: 0.7,
      elevated_oxygen: 0.3,
    },
  },
  {
    code: "CFI",
    name: "Cool Flames Investigation",
    campaign: "CFI",
    role: "Low-temperature cool-flame ignition hazards; highest-O2 testing (CFI-G).",
    fuelClass: "gaseous and liquid fuels",
    facility: "ISS",
    scale: "bench",
    capabilities: {
      elevated_oxygen: 0.7,
      gaseous_fuel: 0.8,
      ignition_extinction_limits: 0.6,
    },
  },
];

/** A partial-gravity environment cannot be fully served by microgravity data. */
const GRAVITY_FACTOR: Record<Environment["gravityClass"], number> = {
  micro: 1,
  partial: 0.6,
};

export interface FitFactor {
  need: Need;
  weight: number;
  capability: number;
  /** weight * capability, the contribution to the raw score. */
  contribution: number;
}

export interface Fit {
  experiment: ExperimentProfile;
  environment: Environment;
  /** 0..100, after the gravity caveat. */
  score: number;
  grade: "strong" | "moderate" | "limited" | "weak";
  /** Every need this environment weighs, sorted by contribution. */
  factors: FitFactor[];
  /** The needs that carried the score, strongest first. */
  topNeeds: Need[];
  /** A microgravity-only corpus leaves partial-gravity environments gapped. */
  gravityGap: boolean;
}

/**
 * Grade bands. The ceiling is deliberately below 100: an environment weighs
 * several needs and no single investigation covers all of them, so the top
 * achievable fit is around 60. The bands are set against that real range rather
 * than an idealised 100, so "strong" means "best available", not "complete".
 */
function gradeOf(score: number): Fit["grade"] {
  if (score >= 55) return "strong";
  if (score >= 42) return "moderate";
  if (score >= 28) return "limited";
  return "weak";
}

/** Weighted overlap between one experiment and one environment. */
export function fitFor(environment: Environment, experiment: ExperimentProfile): Fit {
  const factors: FitFactor[] = Object.entries(environment.needs).map(([need, weight]) => {
    const w = weight ?? 0;
    const capability = experiment.capabilities[need as Need] ?? 0;
    return { need: need as Need, weight: w, capability, contribution: w * capability };
  });

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const raw = factors.reduce((s, f) => s + f.contribution, 0) / totalWeight;
  const score = Math.round(raw * GRAVITY_FACTOR[environment.gravityClass] * 100);

  const ranked = [...factors].sort((a, b) => b.contribution - a.contribution);
  const topNeeds = ranked.filter((f) => f.capability > 0).slice(0, 3).map((f) => f.need);

  return {
    experiment,
    environment,
    score,
    grade: gradeOf(score),
    factors: ranked,
    topNeeds,
    gravityGap: environment.gravityClass === "partial",
  };
}

export interface EnvironmentRanking {
  environment: Environment;
  fits: Fit[];
}

/** Every environment with its investigations ranked best-fit first. */
export function rankAll(): EnvironmentRanking[] {
  return ENVIRONMENTS.map((environment) => ({
    environment,
    fits: EXPERIMENTS.map((e) => fitFor(environment, e)).sort(
      (a, b) => b.score - a.score || a.experiment.code.localeCompare(b.experiment.code),
    ),
  }));
}

/** The strongest environment for each investigation, for the reverse view. */
export function bestEnvironmentFor(experiment: ExperimentProfile): Fit {
  return ENVIRONMENTS.map((e) => fitFor(e, experiment)).sort((a, b) => b.score - a.score)[0];
}

/**
 * Investigations the challenge names that are genuinely absent from *both* the
 * NTRS report corpus and the PSI measured tables LAVA loads. Listing them makes
 * the gap legible instead of silent: a judge can see which fire-safety work the
 * data still needs. Anything the challenge names but that PSI does hold belongs
 * in `NAMED_IN_PSI` below, not here - the two lists must not overlap.
 */
export const NAMED_ABSENT: NamedInvestigation[] = [
  { code: "LUCI", name: "Lunar-g Combustion Investigation", note: "Lunar-gravity combustion; no data in the NTRS corpus or PSI yet." },
  { code: "FM2", name: "Flammability of Materials on the Moon", note: "Lunar-surface flammability; no data in the NTRS corpus or PSI yet." },
];

/** An investigation the challenge names that is present in PSI's measured tables. */
export interface PsiNamedInvestigation {
  code: string;
  name: string;
  /** The PSI investigation id, so the claim is checkable against psi.nasa.gov. */
  psiId: string;
  note: string;
}

/**
 * Investigations the challenge names that PSI *does* hold. These are not gaps:
 * LAVA loads the PSI experiment tables and searches their measured rows, so the
 * measured data is in the system even though the name never appears as a
 * standalone NTRS report. Kept separate from `NAMED_ABSENT` so the page never
 * claims a gap that does not exist.
 */
export const NAMED_IN_PSI: PsiNamedInvestigation[] = [
  { code: "SPICE", name: "Smoke Point In Co-flow Experiment", psiId: "PSI-107", note: "Smoke-point limits for solid and gaseous fuels in the MSG flow duct." },
  { code: "SLICE", name: "Structure & Liftoff In Combustion Experiment", psiId: "PSI-106", note: "Flame structure and liftoff for gaseous fuels in the MSG flow duct." },
  { code: "DAFT-2", name: "Dust and Aerosol Measurement Feasibility Test", psiId: "PSI-47", note: "Reuses a SAME detector to size dust particles; detection hardware crossover." },
  { code: "BRE", name: "Burning Rate Emulator (ACME)", psiId: "PSI-20", note: "Gaseous-fuel emulation of materials burning as a function of material properties." },
  { code: "E-FIELD", name: "Electric-Field Effects on Laminar Diffusion Flames (ACME)", psiId: "PSI-22", note: "Mimics partial gravity via an electric-field body force on flame ions." },
  { code: "CFI-G", name: "Cool Flames Investigation with Gases", psiId: "PSI-159", note: "Highest-oxygen microgravity tests - directly bounds the high-O2 risk." },
];

/** @deprecated Kept for callers that only need the truly-absent set. */
export const NAMED_NOT_IN_CORPUS = NAMED_ABSENT;
