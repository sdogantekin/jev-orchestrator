import type { CurrencyConversion } from "../domain/currency.js";
import { eligiblePsps } from "../domain/eligibility.js";
import type { PspId } from "../domain/types.js";
import { computeObservedView, type ObservedPspStats } from "../simulation/observedView.js";
import { simulatePspOutcome } from "../simulation/outcome.js";
import type { ResolvedScenario } from "../simulation/scenarios.js";
import { generateStream } from "../simulation/stream.js";
import type { RouterFn } from "../routers/types.js";

export interface DecisionRecord {
  transactionIndex: number;
  chosenPspId: PspId;
  authorized: boolean;
  netCostEUR: number;
  latencyMs: number | null;
}

export interface MultiRouterEvaluation {
  decisionsByRouter: Record<string, DecisionRecord[]>;
  singleEligibleCount: number;
  zeroEligibleCount: number;
}

/**
 * Runs every given router over the same transaction range of the same stream, sharing the
 * (expensive) eligibility and observed-view computation per transaction. Section 5.6:
 * transactions with zero eligible PSPs are counted and excluded; transactions with exactly one
 * eligible PSP are routed deterministically (not recorded as a decision) and counted separately.
 */
export function evaluateRouters(args: {
  scenario: ResolvedScenario;
  seed: string;
  streamLength: number;
  rangeStart: number;
  rangeEnd: number; // inclusive
  conversionRates: CurrencyConversion;
  routers: Record<string, RouterFn>;
}): MultiRouterEvaluation {
  const { scenario, seed, streamLength, rangeStart, rangeEnd, conversionRates, routers } = args;
  const stream = generateStream(seed, streamLength, scenario.stream, conversionRates);

  const decisionsByRouter: Record<string, DecisionRecord[]> = {};
  for (const key of Object.keys(routers)) decisionsByRouter[key] = [];

  let singleEligibleCount = 0;
  let zeroEligibleCount = 0;

  for (let t = rangeStart; t <= rangeEnd; t++) {
    const tx = stream[t]!;
    const eligible = eligiblePsps(scenario.world.psps, tx);

    if (eligible.length === 0) {
      zeroEligibleCount++;
      continue;
    }
    if (eligible.length === 1) {
      singleEligibleCount++;
      continue;
    }

    const observed: Partial<Record<PspId, ObservedPspStats>> = {};
    for (const psp of eligible) {
      observed[psp.id] = computeObservedView(stream, t, tx, psp, scenario.world, seed, scenario.observedView);
    }

    for (const [key, routerFn] of Object.entries(routers)) {
      const chosenPspId = routerFn({ tx, eligible, observed });
      const chosenPsp = eligible.find((p) => p.id === chosenPspId);
      if (!chosenPsp) {
        throw new Error(`Router "${key}" chose PSP "${chosenPspId}" which is not in the eligible set at transaction ${t}`);
      }
      const outcome = simulatePspOutcome(seed, t, tx, chosenPsp, scenario.world);
      decisionsByRouter[key]!.push({
        transactionIndex: t,
        chosenPspId,
        authorized: outcome.authorized,
        netCostEUR: outcome.netCostEUR,
        latencyMs: outcome.latencyMs,
      });
    }
  }

  return { decisionsByRouter, singleEligibleCount, zeroEligibleCount };
}
