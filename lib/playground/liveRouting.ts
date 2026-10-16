/**
 * Pure, Node-free versions of the Playground's custom-mode logic (eligibility, R1/R2 routing,
 * simulated outcomes). No fs/network access anywhere in this file, so it can run identically in
 * the browser (instant feedback as a visitor types) and on the server (building the state handed
 * to decideWithJev) from the exact same code path — never two drifting copies of "what the rules
 * do."
 */
import { checkEligibility } from "../domain/eligibility.js";
import { feeEUR } from "../domain/fees.js";
import type { PspConfig } from "../domain/psp.js";
import type { Currency, PspId, Transaction } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";
import type { PspInput, TransactionInput } from "./schema.js";

export interface AmountBucketConfig {
  smallMax: number;
  largeMin: number;
}

export function buildTransaction(input: TransactionInput, amountConfig: AmountBucketConfig, conversionRates: Record<Currency, number>): Transaction {
  const amountEUR = input.amount * conversionRates[input.currency];
  const amountBucket = input.amount < amountConfig.smallMax ? "small" : input.amount < amountConfig.largeMin ? "medium" : "large";
  return {
    index: 0,
    amount: input.amount,
    amountEUR,
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

export function buildPspConfig(input: PspInput): PspConfig {
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
export function buildObservedStats(input: PspInput): ObservedPspStats {
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

export interface SimulatedOutcome {
  available: boolean;
  authorized: boolean;
  chargeback: boolean;
  latencyMs: number | null;
  feeEUR: number;
  netCostEUR: number;
}

/** A single, non-reproducible draw for the playground's one-shot simulated outcome (section 5.7: custom mode simulates directly from the visitor's own numbers, not the seeded experiment stream). */
export function simulateOnceFromInput(psp: PspConfig, amountEUR: number): SimulatedOutcome {
  const available = Math.random() < psp.availabilityRate;
  const authorized = available && Math.random() < psp.baseAcceptanceRate;
  const latencyMs = available ? psp.latencyCentralMs * (1 + (Math.random() * 2 - 1) * 0.2) : null;
  const chargeback = authorized && Math.random() < psp.chargebackRate;
  const fee = authorized ? feeEUR(psp, amountEUR) : 0;
  const chargebackLoss = authorized && chargeback ? amountEUR + 15 : 0;
  return { available, authorized, chargeback, latencyMs, feeEUR: fee, netCostEUR: fee + chargebackLoss };
}

export type EligibilityReport = Array<{ pspId: PspId; eligible: boolean; reasons: string[] }>;

export function checkAllEligibility(allPsps: PspConfig[], tx: Transaction): EligibilityReport {
  return allPsps.map((psp) => {
    const result = checkEligibility(psp, tx);
    return { pspId: psp.id, eligible: result.eligible, reasons: result.reasons };
  });
}

/**
 * A placeholder PspConfig carrying only the two fields the rule engine actually reads for an
 * already-known-eligible PSP (id, fixedFee) — for reconstructing a live rule trace from a
 * recorded preset example, where a full PspConfig was never part of what got committed.
 */
export function minimalPspConfig(id: PspId, fixedFee: number): PspConfig {
  return {
    id,
    name: `PSP ${id}`,
    role: "Recorded",
    enabled: true,
    supportedCurrencies: ["EUR", "GBP", "USD"],
    supportedPaymentMethods: ["card", "paypal", "sepa_debit"],
    baseAcceptanceRate: 0,
    transactionCostPercent: 0,
    fixedFee,
    retrySuccessRate: 0,
    chargebackRate: 0,
    latencyCentralMs: 1,
    availabilityRate: 1,
  };
}

export interface ResolvedCustomState {
  tx: Transaction;
  allPsps: PspConfig[];
  eligibility: EligibilityReport;
  eligible: PspConfig[];
  observed: Record<string, ObservedPspStats>;
}

/** Builds everything R1/R2 (and, server-side, Jev) need from the visitor's raw form input. */
export function resolveCustomState(
  transactionInput: TransactionInput,
  pspInputs: PspInput[],
  amountConfig: AmountBucketConfig,
  conversionRates: Record<Currency, number>
): ResolvedCustomState {
  const tx = buildTransaction(transactionInput, amountConfig, conversionRates);
  const allPsps = pspInputs.map(buildPspConfig);
  const eligibility = checkAllEligibility(allPsps, tx);
  const eligible = allPsps.filter((psp) => eligibility.find((e) => e.pspId === psp.id)!.eligible);
  const observed: Record<string, ObservedPspStats> = {};
  for (const psp of eligible) {
    const input = pspInputs.find((p) => p.id === psp.id)!;
    observed[psp.id] = buildObservedStats(input);
  }
  return { tx, allPsps, eligibility, eligible, observed };
}
