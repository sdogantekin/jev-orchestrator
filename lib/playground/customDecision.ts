import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkEligibility } from "../domain/eligibility.js";
import type { PspConfig } from "../domain/psp.js";
import { feeEUR } from "../domain/fees.js";
import type { PspId, Transaction } from "../domain/types.js";
import { createInMemoryCache } from "../jev/cache.js";
import { decideWithJev, type JevDecisionResult } from "../jev/decide.js";
import type { ObservedPspStats } from "../simulation/observedView.js";
import { createRuleRouter, r1Router, RuleParamsSchema } from "../routers/ruleRouter.js";
import type { RouterInput } from "../routers/types.js";
import { CONFIG_DIR, loadCurrencyConversion, loadStreamConfig } from "../simulation/configLoader.js";
import type { PspInput, TransactionInput } from "./schema.js";

/** R2 has no "custom mode" tuning to fall back to; the Stable scenario's tuned params are a reasonable generic default, shown as such in the UI. */
function loadGenericR2Params() {
  const raw = JSON.parse(readFileSync(join(CONFIG_DIR, "tuned", "stable.json"), "utf-8"));
  return RuleParamsSchema.parse(raw);
}

function buildTransaction(input: TransactionInput): Transaction {
  const streamConfig = loadStreamConfig();
  const rates = loadCurrencyConversion();
  const amountBucket = input.amount < streamConfig.amount.smallMax ? "small" : input.amount < streamConfig.amount.largeMin ? "medium" : "large";
  return {
    index: 0,
    amount: input.amount,
    amountEUR: input.amount * rates[input.currency],
    amountBucket,
    currency: input.currency,
    country: input.country,
    paymentMethod: input.paymentMethod,
    cardScheme: input.paymentMethod === "card" ? input.cardScheme : null,
    device: input.device,
    customerType: input.customerType,
    threeDsEligible: input.threeDsEligible,
  };
}

function buildPspConfig(input: PspInput): PspConfig {
  return {
    id: input.id,
    name: `PSP ${input.id}`,
    role: "Custom",
    enabled: input.enabled,
    supportedCurrencies: input.supportedCurrencies,
    supportedPaymentMethods: input.supportedPaymentMethods,
    baseAcceptanceRate: input.acceptanceRate,
    transactionCostPercent: input.transactionCostPercent,
    fixedFee: input.fixedFee,
    retrySuccessRate: input.retrySuccessRate,
    chargebackRate: input.chargebackRate,
    latencyCentralMs: input.latencyMs,
    availabilityRate: input.availabilityRate,
  };
}

/** In custom mode there is no world/observed split (section 5.7): the visitor's numbers ARE the observed stats, directly. */
function buildObservedStats(input: PspInput): ObservedPspStats {
  return {
    pspId: input.id,
    acceptanceOverall: { value: input.acceptanceRate, sampleSize: input.sampleSize },
    acceptanceSegment: { value: input.acceptanceRate, sampleSize: input.sampleSize },
    availabilityOverall: { value: input.availabilityRate, sampleSize: input.sampleSize },
    chargebackOverall: { value: input.chargebackRate, sampleSize: input.sampleSize },
    averageLatencyMs: { value: input.latencyMs, sampleSize: input.sampleSize },
    retrySuccessRate: input.retrySuccessRate,
  };
}

/** A single, non-reproducible draw for the playground's one-shot simulated outcome (section 5.7: custom mode simulates directly from the visitor's own numbers, not the seeded experiment stream). */
function simulateOnceFromInput(psp: PspConfig, amountEUR: number): { available: boolean; authorized: boolean; chargeback: boolean; latencyMs: number | null; feeEUR: number; netCostEUR: number } {
  const available = Math.random() < psp.availabilityRate;
  const authorized = available && Math.random() < psp.baseAcceptanceRate;
  const latencyMs = available ? psp.latencyCentralMs * (1 + (Math.random() * 2 - 1) * 0.2) : null;
  const chargeback = authorized && Math.random() < psp.chargebackRate;
  const fee = authorized ? feeEUR(psp, amountEUR) : 0;
  const chargebackLoss = authorized && chargeback ? amountEUR + 15 : 0;
  return { available, authorized, chargeback, latencyMs, feeEUR: fee, netCostEUR: fee + chargebackLoss };
}

export type EligibilityReport = Array<{ pspId: PspId; eligible: boolean; reasons: string[] }>;

export type CustomDecisionResult =
  | { status: "zero_eligible"; eligibility: EligibilityReport }
  | {
      status: "single_eligible";
      eligibility: EligibilityReport;
      chosenPspId: PspId;
      outcome: ReturnType<typeof simulateOnceFromInput>;
    }
  | {
      status: "ok";
      eligibility: EligibilityReport;
      r1Choice: PspId;
      r2Choice: PspId;
      r2ParamsSource: "stable (generic default)";
      jev: JevDecisionResult;
      outcomesByPsp: Record<string, ReturnType<typeof simulateOnceFromInput>>;
    };

export async function runCustomDecision(args: {
  transactionInput: TransactionInput;
  pspInputs: PspInput[];
  apiKey: string;
  allowLive: boolean;
}): Promise<CustomDecisionResult> {
  const tx = buildTransaction(args.transactionInput);
  const allPsps = args.pspInputs.map(buildPspConfig);

  const eligibility: EligibilityReport = allPsps.map((psp) => {
    const result = checkEligibility(psp, tx);
    return { pspId: psp.id, eligible: result.eligible, reasons: result.reasons };
  });
  const eligible = allPsps.filter((psp) => eligibility.find((e) => e.pspId === psp.id)!.eligible);

  if (eligible.length === 0) {
    return { status: "zero_eligible", eligibility };
  }
  if (eligible.length === 1) {
    const psp = eligible[0]!;
    return { status: "single_eligible", eligibility, chosenPspId: psp.id, outcome: simulateOnceFromInput(psp, tx.amountEUR) };
  }

  const observed: Record<string, ObservedPspStats> = {};
  for (const psp of eligible) {
    const input = args.pspInputs.find((p) => p.id === psp.id)!;
    observed[psp.id] = buildObservedStats(input);
  }

  const routerInput: RouterInput = { tx, eligible, observed };
  const r1Choice = r1Router(routerInput);
  const r2Router = createRuleRouter(loadGenericR2Params());
  const r2Choice = r2Router(routerInput);

  const jevResult = await decideWithJev({
    tx,
    eligible,
    observed,
    dataRichnessLevel: 2,
    model: process.env.JEV_MODEL?.trim() || "typesafe/jev-1.13",
    cache: createInMemoryCache(),
    allowLive: args.allowLive,
    apiKey: args.apiKey,
  });

  const chosenIds = new Set([r1Choice, r2Choice, ...(jevResult.status === "ok" ? [jevResult.choice] : [])]);
  const outcomesByPsp: Record<string, ReturnType<typeof simulateOnceFromInput>> = {};
  for (const id of chosenIds) {
    const psp = eligible.find((p) => p.id === id)!;
    outcomesByPsp[id] = simulateOnceFromInput(psp, tx.amountEUR);
  }

  return { status: "ok", eligibility, r1Choice, r2Choice, r2ParamsSource: "stable (generic default)", jev: jevResult, outcomesByPsp };
}
