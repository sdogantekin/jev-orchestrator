import type { CurrencyConversion } from "../domain/currency.js";
import { PSP_IDS, type PspId } from "../domain/types.js";
import { evaluateRouters } from "../experiments/evaluate.js";
import { TRAIN_SLICE, tuningSeed } from "../experiments/seeds.js";
import type { ResolvedScenario } from "../simulation/scenarios.js";
import { createRuleRouter, type RuleParams } from "./ruleRouter.js";

export interface GridSearchSpace {
  preferredForEuCard: readonly PspId[];
  preferredForUsd: readonly PspId[];
  preferredDefault: readonly PspId[];
  largeThreshold: readonly number[];
  smallThreshold: readonly number[];
  safetyAvailabilityThreshold: readonly number[];
  safetyAcceptanceThreshold: readonly number[];
}

/** Grid used for the main R2 tuning run. Kept deliberately small (section 6.2 asks for a grid search, not an exhaustive one) to keep tuning time bounded across 6 scenarios. */
export const DEFAULT_GRID: GridSearchSpace = {
  preferredForEuCard: PSP_IDS,
  preferredForUsd: PSP_IDS,
  preferredDefault: PSP_IDS,
  largeThreshold: [400, 500, 600],
  smallThreshold: [20, 25, 30],
  safetyAvailabilityThreshold: [0.98, 0.99],
  safetyAcceptanceThreshold: [0.85, 0.88, 0.9],
};

export function* enumerateGrid(space: GridSearchSpace): Generator<RuleParams> {
  for (const preferredForEuCard of space.preferredForEuCard) {
    for (const preferredForUsd of space.preferredForUsd) {
      for (const preferredDefault of space.preferredDefault) {
        for (const largeThreshold of space.largeThreshold) {
          for (const smallThreshold of space.smallThreshold) {
            for (const safetyAvailabilityThreshold of space.safetyAvailabilityThreshold) {
              for (const safetyAcceptanceThreshold of space.safetyAcceptanceThreshold) {
                yield {
                  preferredForEuCard,
                  preferredForUsd,
                  preferredDefault,
                  largeThreshold,
                  smallThreshold,
                  safetyAvailabilityThreshold,
                  safetyAcceptanceThreshold,
                };
              }
            }
          }
        }
      }
    }
  }
}

function scoreRuleParams(
  scenario: ResolvedScenario,
  seed: string,
  params: RuleParams,
  conversionRates: CurrencyConversion
): { authorizationRate: number; netCostPerAuthorized: number } {
  const router = createRuleRouter(params);
  const { decisionsByRouter } = evaluateRouters({
    scenario,
    seed,
    streamLength: TRAIN_SLICE.end + 1,
    rangeStart: TRAIN_SLICE.start,
    rangeEnd: TRAIN_SLICE.end,
    conversionRates,
    routers: { candidate: router },
  });
  const decisions = decisionsByRouter.candidate!;
  const authorizationRate = decisions.length > 0 ? decisions.filter((d) => d.authorized).length / decisions.length : 0;
  const authorizedCosts = decisions.filter((d) => d.authorized).map((d) => d.netCostEUR);
  const netCostPerAuthorized =
    authorizedCosts.length > 0 ? authorizedCosts.reduce((s, v) => s + v, 0) / authorizedCosts.length : Infinity;
  return { authorizationRate, netCostPerAuthorized };
}

/**
 * R2 tuning (section 6.2): grid search on the training slice of a dedicated tuning stream
 * (never one of the 20 evaluation seeds), maximizing authorization rate, ties broken by lower
 * net cost per authorized transaction.
 */
export function tuneR2(
  scenario: ResolvedScenario,
  scenarioId: string,
  conversionRates: CurrencyConversion,
  space: GridSearchSpace = DEFAULT_GRID
): RuleParams {
  const seed = tuningSeed(scenarioId);
  let best: RuleParams | null = null;
  let bestAuthRate = -Infinity;
  let bestNetCost = Infinity;

  for (const params of enumerateGrid(space)) {
    const { authorizationRate, netCostPerAuthorized } = scoreRuleParams(scenario, seed, params, conversionRates);
    const better =
      authorizationRate > bestAuthRate ||
      (authorizationRate === bestAuthRate && netCostPerAuthorized < bestNetCost);
    if (better) {
      best = params;
      bestAuthRate = authorizationRate;
      bestNetCost = netCostPerAuthorized;
    }
  }

  if (!best) throw new Error("Grid search space was empty");
  return best;
}
