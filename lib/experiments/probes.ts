import type { PspConfig } from "../domain/psp.js";
import type { PspId, Transaction } from "../domain/types.js";
import { callJevDecisions } from "../jev/client.js";
import { buildDecisionsRequest, type DecisionsApiRequest } from "../jev/request.js";
import { withRetry } from "../jev/retry.js";
import { buildDecisionSchema } from "../jev/schema.js";
import { buildJevState } from "../jev/state.js";
import type { ObservedPspStats, ObservedStat } from "../simulation/observedView.js";

/**
 * Probes (section 9.3) are single-decision tests of Jev's behavior, deliberately constructed
 * rather than drawn from the simulator. Every probe calls the live client directly, bypassing
 * decide.ts's cache/fixture layer on purpose: the whole point of several of these probes is to
 * see independent live draws of the *same* state, which a cache would silently defeat.
 */

function stat(value: number, sampleSize = 150): ObservedStat {
  return { value, sampleSize };
}

export function baselinePsps(allPsps: PspConfig[]): PspConfig[] {
  return allPsps;
}

export function baselineObserved(
  psps: PspConfig[],
  overrides: Partial<Record<PspId, Partial<Pick<ObservedPspStats, "acceptanceOverall" | "acceptanceSegment">>>> = {}
): Partial<Record<PspId, ObservedPspStats>> {
  const result: Partial<Record<PspId, ObservedPspStats>> = {};
  for (const psp of psps) {
    const base: ObservedPspStats = {
      pspId: psp.id,
      acceptanceOverall: stat(psp.baseAcceptanceRate),
      acceptanceSegment: stat(psp.baseAcceptanceRate, 30),
      availabilityOverall: stat(psp.availabilityRate),
      chargebackOverall: stat(psp.chargebackRate, 140),
      averageLatencyMs: stat(psp.latencyCentralMs),
      retrySuccessRate: psp.retrySuccessRate,
    };
    const override = overrides[psp.id];
    result[psp.id] = override ? { ...base, ...override } : base;
  }
  return result;
}

export function baselineTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    index: 0,
    amount: 60,
    amountEUR: 60,
    amountBucket: "medium",
    currency: "EUR",
    country: "DE",
    paymentMethod: "card",
    cardScheme: "visa",
    device: "desktop",
    customerType: "returning",
    threeDsEligible: false,
    ...overrides,
  };
}

export interface ProbeCallResult {
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
  cost?: number;
}

export async function callProbe(request: DecisionsApiRequest, apiKey: string, decisionId: string): Promise<ProbeCallResult> {
  const response = await withRetry(() => callJevDecisions(request, { apiKey }));
  const answer = response.answers[decisionId];
  if (!answer) throw new Error(`No answer for "${decisionId}" in probe response`);
  return { choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence, cost: response.usage?.cost };
}

export function buildRequest(
  tx: Transaction,
  eligible: PspConfig[],
  observed: Partial<Record<PspId, ObservedPspStats>>,
  model: string
): DecisionsApiRequest {
  const schema = buildDecisionSchema(eligible);
  const state = buildJevState({ tx, eligible, observed, dataRichnessLevel: 2 });
  return buildDecisionsRequest(schema, state, model);
}
