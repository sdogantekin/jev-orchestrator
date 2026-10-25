import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../simulation/configLoader.js";
import { SCENARIO_IDS, type ScenarioId } from "../simulation/scenarios.js";

const RESULTS_DIR = join(PROJECT_ROOT, "experiments", "results");

function readJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(RESULTS_DIR, filename), "utf-8")) as T;
}

export interface CI {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

export interface RuleBatchResult {
  scenarioId: ScenarioId;
  tunedR2Params: Record<string, unknown>;
  singleEligibleCount: number;
  zeroEligibleCount: number;
  decisionCount: number;
  metrics: Record<
    "R0" | "R1" | "R2",
    {
      authorizationRate: CI;
      netCostPerAuthorized: CI;
      averageLatencyMs: number;
    }
  >;
}

export interface JevMainResult {
  scenarioId: ScenarioId;
  tunedR2Params: Record<string, unknown>;
  singleEligibleCount: number;
  zeroEligibleCount: number;
  summary: {
    n: number;
    jevAuthorizationRate: CI;
    r2AuthorizationRate: CI;
    jevNetCostPerAuthorized: CI;
    r2NetCostPerAuthorized: CI;
    jevAverageCallLatencyMs: number;
    jevWorstCallLatencyMs: number;
    jevAverageCostPerLiveCall: number;
    jevLiveCallCount: number;
    jevOkCount: number;
    jevInvalidCount: number;
    jevFailedCount: number;
    jevFallbackRate: number;
    disagreementRate: number;
    disagreementCount: number;
    onDisagreement: { jevWins: number; r2Wins: number; ties: number };
    confidenceHistogram: Array<{ bucketStart: number; count: number }>;
  };
}

export interface DataRichnessResult {
  scenarioId: string;
  n: number;
  levelSummaries: Array<{
    level: 1 | 2 | 3;
    authorizationRate: CI;
    netCostPerAuthorized: CI;
    okCount: number;
    invalidCount: number;
    failedCount: number;
  }>;
  choiceDiff12: number;
  choiceDiff23: number;
  choiceDiff13: number;
}

export interface SensitivityVariantResult {
  n: number;
  jevAuth: CI;
  r2Auth: CI;
  gapPp: number;
  baselineGapPp: number;
  flipped: boolean;
  disagreementRate: number;
}

export interface SensitivityResult {
  baseline: { jevAuth: number; r2Auth: number };
  [variant: string]: { jevAuth: number; r2Auth: number } | SensitivityVariantResult;
}

export interface CalibrationResult {
  curve: Array<{ bucketRange: [number, number]; meanStatedProbability: number | null; empiricalBestRate: number | null; sampleSize: number }>;
  samplesUsed: number;
  decisionsSkippedNotOk: number;
}

export interface ProbesResult {
  responsiveness: {
    fixedCompetitorId: string;
    fixedCompetitorAcceptance: number;
    sweptPspId: string;
    rows: Array<{ acceptanceStep: number; repeat: number; choice: string; sweptPspProbability: number }>;
  };
  tradeOff: {
    expensivePspId: string;
    cheapPspId: string;
    rows: Array<{ amountBucket: string; amountEUR: number; repeat: number; choice: string }>;
  };
  irrelevance: { rows: Array<{ variant: string; repeat: number; choice: string }> };
  repeatability: {
    rows: Array<{ call: number; choice: string; probabilities: Record<string, number>; confidence?: number }>;
    distinctChoiceCount: number;
  };
}

/** experiments/results/v1-diagnosis.json: Experiment 1 re-scored by expected authorization (EXPERIMENT.md Section 10). */
export interface V1DiagnosisScenario {
  decisions: number;
  oracle: number;
  R0: number;
  R1: number;
  R2: number;
  followOverall: number;
  followSegment: number;
  jev: number;
  jevPicksHighestObservedOverall: number;
  jevPicksHighestObservedSegment: number;
}

/** experiments/results/v2-design-check.json: observed-data error in each world, from the rules-only check. */
export interface V2DesignCheck {
  highVolume: { perTransaction: number };
  scenarios: Record<
    ScenarioId,
    Record<"v1" | "v2", { decisions: number; observedErrorOverallPp: number; observedErrorSegmentPp: number; medianSegmentSampleSize: number }>
  >;
}

/** experiments/results/jev-v2-<scenario>.json: Experiment 2, scored by expected authorization. */
export interface JevV2Result {
  scenarioId: ScenarioId;
  expectedAuth: Record<"jev" | "oracle" | "R0" | "R1" | "R2" | "statsReference" | "jevV1", CI>;
  jevMinus: Record<"R0" | "R1" | "R2" | "statsReference" | "jevV1", CI>;
  headroomCaptured: number;
  realized: JevMainResult["summary"];
}

/** Mirrors docs/hypotheses.md verbatim, so chart badges can show the exact text without parsing the file at render time. */
export const HYPOTHESES: Record<string, string> = {
  H1: "Jev responds correctly to the data it is given: when one PSP's metric improves and everything else is fixed, its probability for that PSP rises sensibly.",
  H2: "On stable traffic, Jev roughly matches a well-tuned rule set.",
  H3: "When rules go stale (a PSP degrades mid-stream) or data is thin (cold start, rare segments), Jev does better than static rules.",
  H4: "Jev loses to rules on decision latency, cost per decision, determinism and auditability.",
  H5: "Jev's output is mostly but not perfectly consistent: repeated calls and harmless input changes (PSP order, field order) sometimes change the choice.",
};

/** Mirrors docs/hypotheses-v2.md (Experiment 2, pre-registered 2026-10-24), hypothesis and pass rule. */
export const HYPOTHESES_V2: Record<string, { text: string; supportedIf: string }> = {
  "V2-H1": { text: "More data helps Jev.", supportedIf: "Jev (v2) − Jev (v1) is positive with CI above zero in at least 5 of 6 scenarios." },
  "V2-H2": { text: "With good data, Jev no longer loses to the rules on stable traffic.", supportedIf: "On Stable, the CI of Jev − R1 includes zero or is above it." },
  "V2-H3": { text: "With good data, Jev beats static rules when a PSP drifts.", supportedIf: "On Drift, Jev − R1 and Jev − R2 are both positive with CI above zero." },
  "V2-H4": { text: "Cold start still hurts Jev.", supportedIf: "On Cold start, Jev − R1 is negative with CI below zero." },
  "V2-H5": { text: "Jev adds nothing beyond simple statistics.", supportedIf: "In no scenario is Jev − statistics reference positive with CI above zero." },
};

export function hypotheses(...ids: string[]): Array<{ id: string; text: string }> {
  return ids.map((id) => ({ id, text: HYPOTHESES[id] ?? HYPOTHESES_V2[id]?.text ?? "" }));
}

export function loadAllResults() {
  const ruleResults = Object.fromEntries(SCENARIO_IDS.map((id) => [id, readJson<RuleBatchResult>(`${id}.json`)])) as Record<ScenarioId, RuleBatchResult>;
  const jevMainResults = Object.fromEntries(SCENARIO_IDS.map((id) => [id, readJson<JevMainResult>(`jev-main-${id}.json`)])) as Record<ScenarioId, JevMainResult>;
  const dataRichness = {
    stable: readJson<DataRichnessResult>("data-richness-stable.json"),
    drift: readJson<DataRichnessResult>("data-richness-drift.json"),
  };
  const sensitivity = readJson<SensitivityResult>("sensitivity.json");
  const calibration = readJson<CalibrationResult>("calibration.json");
  const probes = readJson<ProbesResult>("probes.json");
  const v1Diagnosis = readJson<Record<ScenarioId, V1DiagnosisScenario>>("v1-diagnosis.json");
  const v2DesignCheck = readJson<V2DesignCheck>("v2-design-check.json");
  const jevV2Results = Object.fromEntries(SCENARIO_IDS.map((id) => [id, readJson<JevV2Result>(`jev-v2-${id}.json`)])) as Record<ScenarioId, JevV2Result>;

  return { ruleResults, jevMainResults, dataRichness, sensitivity, calibration, probes, v1Diagnosis, v2DesignCheck, jevV2Results };
}

export type AllResults = ReturnType<typeof loadAllResults>;
