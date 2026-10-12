import type { CurrencyConversion } from "../domain/currency.js";
import { eligiblePsps } from "../domain/eligibility.js";
import type { PspConfig } from "../domain/psp.js";
import type { PspId, Transaction } from "../domain/types.js";
import type { JevCache } from "../jev/cache.js";
import { callJevDecisions } from "../jev/client.js";
import { decideWithJev, type JevDecisionResult, type JevDecisionSource } from "../jev/decide.js";
import { withRetry } from "../jev/retry.js";
import type { DataRichnessLevel } from "../jev/state.js";
import { r1Router } from "../routers/ruleRouter.js";
import { computeObservedView, computeRecentSegmentOutcomes, type ObservedPspStats } from "../simulation/observedView.js";
import { simulatePspOutcome } from "../simulation/outcome.js";
import type { ResolvedScenario } from "../simulation/scenarios.js";
import { generateStream } from "../simulation/stream.js";
import { mapWithConcurrency } from "./concurrency.js";
import { STREAM_LENGTH, TEST_SLICE } from "./seeds.js";

export interface JevDecisionRecord {
  transactionIndex: number;
  jevStatus: JevDecisionResult["status"];
  usedFallback: boolean;
  chosenPspId: PspId;
  authorized: boolean;
  netCostEUR: number;
  latencyMs: number | null;
  jevConfidence?: number;
  jevProbabilities?: Record<string, number>;
  /** Wall-clock time of the Jev call itself, only meaningful when the answer came from a live call. */
  jevCallLatencyMs?: number;
  jevCost?: number;
  jevSource?: JevDecisionSource;
}

export interface JevBatchResult {
  decisions: JevDecisionRecord[];
  singleEligibleCount: number;
  zeroEligibleCount: number;
}

/**
 * Runs Jev (with R1 fallback on invalid/failed, section 8.5.5) over one seed's test slice for
 * one scenario, at a given data richness level, with bounded concurrency and retries. Fixtures
 * (and the in-run cache) make this idempotent across process restarts: a rerun only pays for
 * decisions that don't already have a recorded fixture.
 */
export async function runJevBatchForSeed(args: {
  scenario: ResolvedScenario;
  seed: string;
  model: string;
  cache: JevCache;
  dataRichnessLevel: DataRichnessLevel;
  conversionRates: CurrencyConversion;
  apiKey: string;
  concurrency?: number;
  fixturesDir?: string;
  /** Injectable for tests, so no real network call happens outside an explicit live script. Defaults to the real retry-wrapped client. */
  callClient?: typeof callJevDecisions;
}): Promise<JevBatchResult> {
  const stream = generateStream(args.seed, STREAM_LENGTH, args.scenario.stream, args.conversionRates);

  interface Task {
    t: number;
    tx: Transaction;
    eligible: PspConfig[];
    observed: Partial<Record<PspId, ObservedPspStats>>;
    recentOutcomes?: Partial<Record<PspId, boolean[]>>;
  }

  const tasks: Task[] = [];
  let singleEligibleCount = 0;
  let zeroEligibleCount = 0;

  for (let t = TEST_SLICE.start; t <= TEST_SLICE.end; t++) {
    const tx = stream[t]!;
    const eligible = eligiblePsps(args.scenario.world.psps, tx);
    if (eligible.length === 0) {
      zeroEligibleCount++;
      continue;
    }
    if (eligible.length === 1) {
      singleEligibleCount++;
      continue;
    }

    const observed: Partial<Record<PspId, ObservedPspStats>> = {};
    const recentOutcomes: Partial<Record<PspId, boolean[]>> = {};
    for (const psp of eligible) {
      observed[psp.id] = computeObservedView(stream, t, tx, psp, args.scenario.world, args.seed, args.scenario.observedView);
      if (args.dataRichnessLevel >= 3) {
        recentOutcomes[psp.id] = computeRecentSegmentOutcomes(stream, t, tx, psp, args.scenario.world, args.seed, args.scenario.observedView);
      }
    }

    tasks.push({ t, tx, eligible, observed, recentOutcomes: args.dataRichnessLevel >= 3 ? recentOutcomes : undefined });
  }

  const decisions = await mapWithConcurrency(tasks, args.concurrency ?? 20, async (task): Promise<JevDecisionRecord> => {
    const callStarted = Date.now();
    const result = await decideWithJev({
      tx: task.tx,
      eligible: task.eligible,
      observed: task.observed,
      recentSegmentOutcomes: task.recentOutcomes,
      dataRichnessLevel: args.dataRichnessLevel,
      model: args.model,
      cache: args.cache,
      allowLive: true,
      apiKey: args.apiKey,
      fixturesDir: args.fixturesDir,
      callClient: (request, options) => withRetry(() => (args.callClient ?? callJevDecisions)(request, options)),
    });
    const callLatencyMs = Date.now() - callStarted;

    let chosenPspId: PspId;
    let usedFallback = false;
    if (result.status === "ok") {
      chosenPspId = result.choice;
    } else {
      usedFallback = true;
      chosenPspId = r1Router({ tx: task.tx, eligible: task.eligible, observed: task.observed });
    }

    const chosenPsp = task.eligible.find((p) => p.id === chosenPspId)!;
    const outcome = simulatePspOutcome(args.seed, task.t, task.tx, chosenPsp, args.scenario.world);

    return {
      transactionIndex: task.t,
      jevStatus: result.status,
      usedFallback,
      chosenPspId,
      authorized: outcome.authorized,
      netCostEUR: outcome.netCostEUR,
      latencyMs: outcome.latencyMs,
      jevConfidence: result.status === "ok" ? result.confidence : undefined,
      jevProbabilities: result.status === "ok" ? result.probabilities : undefined,
      jevCallLatencyMs: result.status === "ok" && result.source === "live" ? callLatencyMs : undefined,
      jevCost: result.status === "ok" ? result.usage?.cost : undefined,
      jevSource: result.status === "ok" ? result.source : undefined,
    };
  });

  return { decisions, singleEligibleCount, zeroEligibleCount };
}
