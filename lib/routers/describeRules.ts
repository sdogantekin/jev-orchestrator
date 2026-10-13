import type { RuleParams } from "./ruleRouter.js";

/** Plain-language rendering of the exact rule order evaluated by createRuleRouter (ruleRouter.ts). */
export function describeRuleParams(params: RuleParams): string[] {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return [
    `EUR card payments from Germany, the Netherlands, or France → prefer ${params.preferredForEuCard}.`,
    `USD transactions → prefer ${params.preferredForUsd}.`,
    `Amount ≥ €${params.largeThreshold} → pick whichever eligible PSP has the highest observed acceptance rate.`,
    `Amount < €${params.smallThreshold} → pick whichever eligible PSP has the lowest fixed fee.`,
    `Anything else → prefer ${params.preferredDefault}.`,
    `If the preferred PSP from the rules above isn't eligible for this transaction → fall back to the highest-acceptance eligible PSP instead.`,
    `Safety check: if the preferred PSP's observed availability is below ${pct(params.safetyAvailabilityThreshold)} or its observed acceptance is below ${pct(params.safetyAcceptanceThreshold)} → fall back to the highest-acceptance eligible PSP instead.`,
    `Whenever two or more eligible PSPs are exactly tied on acceptance or on fee (in any of the rules above that compare them) → prefer whichever has the lower observed chargeback rate, before falling back to a fixed PSP order.`,
  ];
}
