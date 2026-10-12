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

/** Mirrors docs/hypotheses.md verbatim, so chart badges can show the exact text without parsing the file at render time. */
export const HYPOTHESES: Record<string, string> = {
  H1: "Jev responds correctly to the data it is given: when one PSP's metric improves and everything else is fixed, its probability for that PSP rises sensibly.",
  H2: "On stable traffic, Jev roughly matches a well-tuned rule set.",
  H3: "When rules go stale (a PSP degrades mid-stream) or data is thin (cold start, rare segments), Jev does better than static rules.",
  H4: "Jev loses to rules on decision latency, cost per decision, determinism and auditability.",
  H5: "Jev's output is mostly but not perfectly consistent: repeated calls and harmless input changes (PSP order, field order) sometimes change the choice.",
};

export function hypotheses(...ids: string[]): Array<{ id: string; text: string }> {
  return ids.map((id) => ({ id, text: HYPOTHESES[id] ?? "" }));
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

  return { ruleResults, jevMainResults, dataRichness, sensitivity, calibration, probes };
}

export type AllResults = ReturnType<typeof loadAllResults>;
