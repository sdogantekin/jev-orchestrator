import { feeEUR } from "../domain/fees.js";
import type { PspConfig } from "../domain/psp.js";
import type { PspId, Transaction } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";

/** Section 8.6: how much observed data Jev gets. */
export type DataRichnessLevel = 1 | 2 | 3;

export interface JevPspState {
  id: PspId;
  fixed_fee_eur: number;
  cost_percent: number;
  expected_fee_eur: number;
  acceptance_rate_overall: number | null;
  acceptance_rate_overall_sample_size: number;
  acceptance_rate_segment?: number | null;
  acceptance_rate_segment_sample_size?: number;
  availability_rate_overall: number | null;
  availability_rate_overall_sample_size: number;
  chargeback_rate_overall: number | null;
  chargeback_rate_overall_sample_size: number;
  average_latency_ms: number | null;
  average_latency_ms_sample_size: number;
  retry_success_rate: number;
  recent_segment_outcomes?: Array<"authorized" | "declined">;
}

export interface JevState {
  transaction: {
    amount_eur: number;
    currency: string;
    country: string;
    payment_method: string;
    card_scheme: string | null;
    device: string;
    customer_type: string;
    three_ds_eligible: boolean;
    amount_bucket: string;
  };
  psps: JevPspState[];
}

function round(x: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(x * factor) / factor;
}

/**
 * Builds the sanitized state Jev sees (section 8.2): transaction context, eligible PSPs with
 * their observed metrics and sample sizes, and one derived field (expected fee). Deliberately
 * excludes anything from WorldConfig, any scenario id/name, and any router id/name — nothing
 * here reveals the experiment design. See the contract test in state.test.ts.
 */
export function buildJevState(args: {
  tx: Transaction;
  eligible: PspConfig[];
  observed: Partial<Record<PspId, ObservedPspStats>>;
  recentSegmentOutcomes?: Partial<Record<PspId, boolean[]>>;
  dataRichnessLevel: DataRichnessLevel;
}): JevState {
  const { tx, eligible, observed, recentSegmentOutcomes, dataRichnessLevel } = args;

  return {
    transaction: {
      amount_eur: round(tx.amountEUR, 2),
      currency: tx.currency,
      country: tx.country,
      payment_method: tx.paymentMethod,
      card_scheme: tx.cardScheme,
      device: tx.device,
      customer_type: tx.customerType,
      three_ds_eligible: tx.threeDsEligible,
      amount_bucket: tx.amountBucket,
    },
    psps: eligible.map((psp) => {
      const stats = observed[psp.id];
      const entry: JevPspState = {
        id: psp.id,
        fixed_fee_eur: psp.fixedFee,
        cost_percent: psp.transactionCostPercent,
        expected_fee_eur: round(feeEUR(psp, tx.amountEUR), 4),
        acceptance_rate_overall: stats?.acceptanceOverall.value ?? null,
        acceptance_rate_overall_sample_size: stats?.acceptanceOverall.sampleSize ?? 0,
        availability_rate_overall: stats?.availabilityOverall.value ?? null,
        availability_rate_overall_sample_size: stats?.availabilityOverall.sampleSize ?? 0,
        chargeback_rate_overall: stats?.chargebackOverall.value ?? null,
        chargeback_rate_overall_sample_size: stats?.chargebackOverall.sampleSize ?? 0,
        average_latency_ms: stats?.averageLatencyMs.value ?? null,
        average_latency_ms_sample_size: stats?.averageLatencyMs.sampleSize ?? 0,
        retry_success_rate: psp.retrySuccessRate,
      };

      if (dataRichnessLevel >= 2) {
        entry.acceptance_rate_segment = stats?.acceptanceSegment.value ?? null;
        entry.acceptance_rate_segment_sample_size = stats?.acceptanceSegment.sampleSize ?? 0;
      }
      if (dataRichnessLevel >= 3) {
        const outcomes = recentSegmentOutcomes?.[psp.id] ?? [];
        entry.recent_segment_outcomes = outcomes.map((authorized) => (authorized ? "authorized" : "declined"));
      }

      return entry;
    }),
  };
}
