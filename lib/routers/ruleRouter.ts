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

/** One row of {@link describeRuleParams}'s 8-item list, with whether it actually fired for a given decision. */
export interface RuleTraceRow {
  n: number;
  fired: boolean;
}

export interface TracedChoice {
  choice: PspId;
  /** Always 8 rows, n 1-8, same order and meaning as describeRuleParams()'s list. */
  trace: RuleTraceRow[];
}

function observedAcceptance(stats: ObservedPspStats | undefined): number {
  // No data yet counts as the worst possible candidate, never as a reason to prefer a PSP.
  return stats?.acceptanceOverall.value ?? -Infinity;
}

function observedChargeback(stats: ObservedPspStats | undefined): number {
  // No data yet counts as the worst possible candidate for this tiebreak, never a reason to prefer a PSP.
  return stats?.chargebackOverall.value ?? Infinity;
}

/** Among candidates tied on the primary criterion, prefers the lower observed chargeback rate; a further tie keeps canonical PSP order. */
function breakTieByChargeback(tied: PspConfig[], observed: Partial<Record<PspId, ObservedPspStats>>): PspId {
  let best = tied[0]!;
  let bestScore = observedChargeback(observed[best.id]);
  for (const psp of tied.slice(1)) {
    const score = observedChargeback(observed[psp.id]);
    if (score < bestScore) {
      best = psp;
      bestScore = score;
    }
  }
  return best.id;
}

/** Highest observed overall acceptance among the eligible set; an exact tie breaks by observed chargeback rate, lower is better. */
function highestAcceptanceEligible(eligible: PspConfig[], observed: Partial<Record<PspId, ObservedPspStats>>): { id: PspId; tieBroken: boolean } {
  let bestScore = -Infinity;
  for (const psp of eligible) {
    const score = observedAcceptance(observed[psp.id]);
    if (score > bestScore) bestScore = score;
  }
  const tied = eligible.filter((psp) => observedAcceptance(observed[psp.id]) === bestScore);
  return tied.length === 1 ? { id: tied[0]!.id, tieBroken: false } : { id: breakTieByChargeback(tied, observed), tieBroken: true };
}

/** Lowest fixed fee among the eligible set; an exact tie breaks by observed chargeback rate, lower is better. */
function lowestFixedFeeEligible(eligible: PspConfig[], observed: Partial<Record<PspId, ObservedPspStats>>): { id: PspId; tieBroken: boolean } {
  let bestFee = Infinity;
  for (const psp of eligible) {
    if (psp.fixedFee < bestFee) bestFee = psp.fixedFee;
  }
  const tied = eligible.filter((psp) => psp.fixedFee === bestFee);
  return tied.length === 1 ? { id: tied[0]!.id, tieBroken: false } : { id: breakTieByChargeback(tied, observed), tieBroken: true };
}

/** UI rules 1-5 (describeRuleParams numbering): first match wins. */
function candidateFromOrderedRules(input: RouterInput, params: RuleParams): { id: PspId; ruleN: number; tieBroken: boolean } {
  const { tx, eligible, observed } = input;

  if (tx.currency === "EUR" && tx.paymentMethod === "card" && (["DE", "NL", "FR"] as const).includes(tx.country as "DE" | "NL" | "FR")) {
    return { id: params.preferredForEuCard, ruleN: 1, tieBroken: false };
  }
  if (tx.currency === "USD") {
    return { id: params.preferredForUsd, ruleN: 2, tieBroken: false };
  }
  if (tx.amount >= params.largeThreshold) {
    const r = highestAcceptanceEligible(eligible, observed);
    return { id: r.id, ruleN: 3, tieBroken: r.tieBroken };
  }
  if (tx.amount < params.smallThreshold) {
    const r = lowestFixedFeeEligible(eligible, observed);
    return { id: r.id, ruleN: 4, tieBroken: r.tieBroken };
  }
  return { id: params.preferredDefault, ruleN: 5, tieBroken: false };
}

/**
 * The single evaluation path both createRuleRouter and runRuleRouterTraced run through, so the
 * traced UI view can never drift from what the router actually does. UI rule 6 (preferred PSP
 * not eligible) and rule 7 (safety fallback on the preferred PSP's observed availability/
 * acceptance) are applied in that order: rule 7 can only inspect observed stats for a PSP the
 * router was actually given data for, so an ineligible preferred PSP must be replaced (rule 6)
 * before the safety check (rule 7) has anything to inspect — meaning rule 7 never actually runs
 * when rule 6 already fired.
 */
function evaluateTraced(params: RuleParams, input: RouterInput): TracedChoice {
  const { eligible, observed } = input;
  const eligibleIds = new Set(eligible.map((p) => p.id));

  const primary = candidateFromOrderedRules(input, params);
  let choice = primary.id;
  let usedIneligibleFallback = false;
  let usedSafetyFallback = false;
  let fallbackTieBroken = false;

  if (!eligibleIds.has(choice)) {
    usedIneligibleFallback = true;
    const r = highestAcceptanceEligible(eligible, observed);
    choice = r.id;
    fallbackTieBroken = r.tieBroken;
  } else {
    const stats = observed[choice];
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
      usedSafetyFallback = true;
      const r = highestAcceptanceEligible(eligible, observed);
      choice = r.id;
      fallbackTieBroken = r.tieBroken;
    }
  }

  const trace: RuleTraceRow[] = [1, 2, 3, 4, 5].map((n) => ({ n, fired: n === primary.ruleN }));
  trace.push({ n: 6, fired: usedIneligibleFallback });
  trace.push({ n: 7, fired: usedSafetyFallback });
  trace.push({ n: 8, fired: primary.tieBroken || fallbackTieBroken });

  return { choice, trace };
}

export function createRuleRouter(params: RuleParams): RouterFn {
  return (input) => evaluateTraced(params, input).choice;
}

/** Same evaluation as createRuleRouter's router, plus which of describeRuleParams()'s 8 rules fired — for the Playground's live rule-book view. */
export function runRuleRouterTraced(params: RuleParams, input: RouterInput): TracedChoice {
  return evaluateTraced(params, input);
}

export const r1Router: RouterFn = createRuleRouter(DEFAULT_RULE_PARAMS);
