import { z } from "zod";
import type { PspConfig } from "../domain/psp.js";
import { PSP_IDS, type PspId } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";
import type { RouterFn, RouterInput } from "./types.js";

/**
 * Parameters for the R1/R2 rule structure (section 6.1). R1 uses {@link DEFAULT_RULE_PARAMS}
 * as hand-tuned defaults; R2 uses the same structure with parameters chosen by grid search
 * (section 6.2). `largeThreshold`/`smallThreshold` are the router's own amount cutoffs — not
 * necessarily the stream's `amountBucket` boundaries, since a rules engine's idea of "large"
 * is itself a tunable parameter, independent of how the simulator buckets transactions.
 */
export const RuleParamsSchema = z.object({
  preferredForEuCard: z.enum(PSP_IDS),
  preferredForUsd: z.enum(PSP_IDS),
  preferredDefault: z.enum(PSP_IDS),
  largeThreshold: z.number().positive(),
  smallThreshold: z.number().positive(),
  safetyAvailabilityThreshold: z.number().min(0).max(1),
  safetyAcceptanceThreshold: z.number().min(0).max(1),
});
export type RuleParams = z.infer<typeof RuleParamsSchema>;

export const DEFAULT_RULE_PARAMS: RuleParams = {
  preferredForEuCard: "beta",
  preferredForUsd: "alpha",
  preferredDefault: "alpha",
  largeThreshold: 500,
  smallThreshold: 25,
  safetyAvailabilityThreshold: 0.99,
  safetyAcceptanceThreshold: 0.88,
};

function observedAcceptance(stats: ObservedPspStats | undefined): number {
  // No data yet counts as the worst possible candidate, never as a reason to prefer a PSP.
  return stats?.acceptanceOverall.value ?? -Infinity;
}

/** Highest observed overall acceptance among the eligible set; ties break by canonical PSP order. */
function highestAcceptanceEligible(eligible: PspConfig[], observed: Partial<Record<PspId, ObservedPspStats>>): PspId {
  let best = eligible[0]!;
  let bestScore = observedAcceptance(observed[best.id]);
  for (const psp of eligible.slice(1)) {
    const score = observedAcceptance(observed[psp.id]);
    if (score > bestScore) {
      best = psp;
      bestScore = score;
    }
  }
  return best.id;
}

/** Lowest fixed fee among the eligible set; ties break by canonical PSP order. */
function lowestFixedFeeEligible(eligible: PspConfig[]): PspId {
  let best = eligible[0]!;
  for (const psp of eligible.slice(1)) {
    if (psp.fixedFee < best.fixedFee) best = psp;
  }
  return best.id;
}

/** Rules 2 through 6 (section 6.1): first match wins, yields a candidate PSP id that may or may not be eligible. */
function candidateFromOrderedRules(input: RouterInput, params: RuleParams): PspId {
  const { tx, eligible, observed } = input;

  if (tx.currency === "EUR" && tx.paymentMethod === "card" && (["DE", "NL", "FR"] as const).includes(tx.country as "DE" | "NL" | "FR")) {
    return params.preferredForEuCard; // rule 2
  }
  if (tx.currency === "USD") {
    return params.preferredForUsd; // rule 3
  }
  if (tx.amount >= params.largeThreshold) {
    return highestAcceptanceEligible(eligible, observed); // rule 4
  }
  if (tx.amount < params.smallThreshold) {
    return lowestFixedFeeEligible(eligible); // rule 5
  }
  return params.preferredDefault; // rule 6
}

/**
 * Builds an R1/R2-shaped router from a set of parameters. Rule 8 (preferred PSP not eligible)
 * and rule 7 (safety fallback on the preferred PSP's observed availability/acceptance) are
 * applied in that logical order: rule 7 can only inspect observed stats for a PSP the router
 * was actually given data for, so an ineligible preferred PSP must be replaced (rule 8) before
 * the safety check (rule 7) has anything to inspect.
 */
export function createRuleRouter(params: RuleParams): RouterFn {
  return (input) => {
    const { eligible, observed } = input;
    const eligibleIds = new Set(eligible.map((p) => p.id));

    const preferred = candidateFromOrderedRules(input, params);

    if (!eligibleIds.has(preferred)) {
      return highestAcceptanceEligible(eligible, observed); // rule 8
    }

    const stats = observed[preferred];
    const availability = stats?.availabilityOverall.value;
    const acceptance = stats?.acceptanceOverall.value;
    const unsafe =
      availability === undefined ||
      availability === null ||
      availability < params.safetyAvailabilityThreshold ||
      acceptance === undefined ||
      acceptance === null ||
      acceptance < params.safetyAcceptanceThreshold;

    if (unsafe) {
      return highestAcceptanceEligible(eligible, observed); // rule 7
    }

    return preferred;
  };
}

export const r1Router: RouterFn = createRuleRouter(DEFAULT_RULE_PARAMS);
