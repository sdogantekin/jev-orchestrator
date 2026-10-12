import { bootstrapMeanCI, bootstrapMeanCIStandalone, generateResampleIndices, type ConfidenceInterval } from "./metrics.js";
import type { DecisionRecord } from "./evaluate.js";
import type { JevDecisionRecord } from "./jevBatch.js";

export type DisagreementOutcome = "jev_wins" | "r2_wins" | "tie";

/** Section 9.1: authorized beats not authorized; otherwise lower net cost wins; otherwise tie. */
export function compareOutcomes(a: { authorized: boolean; netCostEUR: number }, b: { authorized: boolean; netCostEUR: number }): DisagreementOutcome {
  if (a.authorized !== b.authorized) return a.authorized ? "jev_wins" : "r2_wins";
  if (a.netCostEUR < b.netCostEUR) return "jev_wins";
  if (a.netCostEUR > b.netCostEUR) return "r2_wins";
  return "tie";
}

export interface PairedDecision {
  seed: string;
  transactionIndex: number;
  jev: JevDecisionRecord;
  r2: DecisionRecord;
}

export interface JevVsR2Summary {
  n: number;
  jevAuthorizationRate: ConfidenceInterval;
  r2AuthorizationRate: ConfidenceInterval;
  jevNetCostPerAuthorized: ConfidenceInterval;
  r2NetCostPerAuthorized: ConfidenceInterval;
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
}

/** Builds the paired dataset the key table (9.4) is computed from. Assumes both arrays cover exactly the same (seed, transactionIndex) pairs. */
export function pairDecisions(jevBySeed: Map<string, JevDecisionRecord[]>, r2BySeed: Map<string, DecisionRecord[]>): PairedDecision[] {
  const paired: PairedDecision[] = [];
  for (const [seed, jevDecisions] of jevBySeed) {
    const r2Decisions = r2BySeed.get(seed);
    if (!r2Decisions) throw new Error(`No R2 decisions for seed "${seed}"`);
    const r2ByIndex = new Map(r2Decisions.map((d) => [d.transactionIndex, d]));
    for (const jev of jevDecisions) {
      const r2 = r2ByIndex.get(jev.transactionIndex);
      if (!r2) throw new Error(`No R2 decision for seed "${seed}" transaction ${jev.transactionIndex} — eligibility must have diverged`);
      paired.push({ seed, transactionIndex: jev.transactionIndex, jev, r2 });
    }
  }
  return paired;
}

export function summarizeJevVsR2(paired: PairedDecision[], bootstrapIterations = 2000, ciSeed = "jev-vs-r2"): JevVsR2Summary {
  const n = paired.length;
  const resampleIndices = generateResampleIndices(n, bootstrapIterations, ciSeed);

  const jevAuthIndicator = paired.map((p) => (p.jev.authorized ? 1 : 0));
  const r2AuthIndicator = paired.map((p) => (p.r2.authorized ? 1 : 0));
  const jevAuthorizationRate = bootstrapMeanCI(jevAuthIndicator, resampleIndices);
  const r2AuthorizationRate = bootstrapMeanCI(r2AuthIndicator, resampleIndices);

  const jevAuthorizedCosts = paired.filter((p) => p.jev.authorized).map((p) => p.jev.netCostEUR);
  const r2AuthorizedCosts = paired.filter((p) => p.r2.authorized).map((p) => p.r2.netCostEUR);
  const jevNetCostPerAuthorized = bootstrapMeanCIStandalone(jevAuthorizedCosts, bootstrapIterations, `${ciSeed}|jev-netcost`);
  const r2NetCostPerAuthorized = bootstrapMeanCIStandalone(r2AuthorizedCosts, bootstrapIterations, `${ciSeed}|r2-netcost`);

  const liveLatencies = paired.map((p) => p.jev.jevCallLatencyMs).filter((l): l is number => l !== undefined);
  const liveCosts = paired.map((p) => p.jev.jevCost).filter((c): c is number => c !== undefined);

  const okCount = paired.filter((p) => p.jev.jevStatus === "ok").length;
  const invalidCount = paired.filter((p) => p.jev.jevStatus === "invalid").length;
  const failedCount = paired.filter((p) => p.jev.jevStatus === "failed").length;
  const fallbackCount = paired.filter((p) => p.jev.usedFallback).length;

  const disagreements = paired.filter((p) => p.jev.chosenPspId !== p.r2.chosenPspId);
  let jevWins = 0,
    r2Wins = 0,
    ties = 0;
  for (const d of disagreements) {
    const outcome = compareOutcomes(d.jev, d.r2);
    if (outcome === "jev_wins") jevWins++;
    else if (outcome === "r2_wins") r2Wins++;
    else ties++;
  }

  const confidences = paired.map((p) => p.jev.jevConfidence).filter((c): c is number => c !== undefined);
  const confidenceHistogram = buildHistogram(confidences, 10);

  return {
    n,
    jevAuthorizationRate,
    r2AuthorizationRate,
    jevNetCostPerAuthorized,
    r2NetCostPerAuthorized,
    jevAverageCallLatencyMs: average(liveLatencies),
    jevWorstCallLatencyMs: liveLatencies.length > 0 ? Math.max(...liveLatencies) : NaN,
    jevAverageCostPerLiveCall: average(liveCosts),
    jevLiveCallCount: liveCosts.length,
    jevOkCount: okCount,
    jevInvalidCount: invalidCount,
    jevFailedCount: failedCount,
    jevFallbackRate: n > 0 ? fallbackCount / n : NaN,
    disagreementRate: n > 0 ? disagreements.length / n : NaN,
    disagreementCount: disagreements.length,
    onDisagreement: { jevWins, r2Wins, ties },
    confidenceHistogram,
  };
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
}

function buildHistogram(values: number[], buckets: number): Array<{ bucketStart: number; count: number }> {
  const histogram = Array.from({ length: buckets }, (_, i) => ({ bucketStart: i / buckets, count: 0 }));
  for (const v of values) {
    const idx = Math.min(buckets - 1, Math.floor(v * buckets));
    histogram[idx]!.count++;
  }
  return histogram;
}
