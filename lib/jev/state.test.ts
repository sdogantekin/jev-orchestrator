import { describe, expect, it } from "vitest";
import type { PspConfig } from "../domain/psp.js";
import type { Transaction } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";
import { buildJevState } from "./state.js";

const alpha: PspConfig = {
  id: "alpha",
  name: "PSP Alpha",
  role: "Generalist",
  enabled: true,
  supportedCurrencies: ["EUR", "GBP", "USD"],
  supportedPaymentMethods: ["card", "paypal"],
  baseAcceptanceRate: 0.945,
  transactionCostPercent: 1.3,
  fixedFee: 0.25,
  retrySuccessRate: 0.31,
  chargebackRate: 0.0018,
  latencyCentralMs: 420,
  availabilityRate: 0.999,
};

const beta: PspConfig = { ...alpha, id: "beta", name: "PSP Beta", role: "EU specialist", baseAcceptanceRate: 0.93 };

const tx: Transaction = {
  index: 500,
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
};

const stats: ObservedPspStats = {
  pspId: "alpha",
  acceptanceOverall: { value: 0.9, sampleSize: 120 },
  acceptanceSegment: { value: 0.88, sampleSize: 30 },
  availabilityOverall: { value: 0.998, sampleSize: 120 },
  chargebackOverall: { value: 0.002, sampleSize: 100 },
  averageLatencyMs: { value: 410, sampleSize: 120 },
  retrySuccessRate: 0.31,
};

describe("buildJevState contract", () => {
  it("includes the transaction context", () => {
    const state = buildJevState({ tx, eligible: [alpha], observed: { alpha: stats }, dataRichnessLevel: 2 });
    expect(state.transaction).toEqual({
      amount_eur: 60,
      currency: "EUR",
      country: "DE",
      payment_method: "card",
      card_scheme: "visa",
      device: "desktop",
      customer_type: "returning",
      three_ds_eligible: false,
      amount_bucket: "medium",
    });
  });

  it("includes only the eligible PSPs passed in, never ineligible ones", () => {
    const state = buildJevState({ tx, eligible: [alpha], observed: { alpha: stats, beta: { ...stats, pspId: "beta" } }, dataRichnessLevel: 2 });
    expect(state.psps.map((p) => p.id)).toEqual(["alpha"]);
  });

  it("never includes a world value (base acceptance rate, hidden modifiers, drift, scenario or router identifiers)", () => {
    const state = buildJevState({ tx, eligible: [alpha, beta], observed: { alpha: stats, beta: { ...stats, pspId: "beta" } }, dataRichnessLevel: 3 });
    const serialized = JSON.stringify(state);

    // The PSP's real baseAcceptanceRate (0.945) must not leak, even though the observed
    // acceptance (0.9) is deliberately close to it in this fixture.
    expect(serialized).not.toContain("0.945");
    expect(serialized.toLowerCase()).not.toContain("scenario");
    expect(serialized.toLowerCase()).not.toContain("stable");
    expect(serialized.toLowerCase()).not.toContain("drift");
    expect(serialized).not.toContain("R0");
    expect(serialized).not.toContain("R1");
    expect(serialized).not.toContain("R2");
    expect(serialized).not.toContain("R3");
  });

  it("level 1 omits segment fields and recent outcomes", () => {
    const state = buildJevState({ tx, eligible: [alpha], observed: { alpha: stats }, dataRichnessLevel: 1 });
    expect(state.psps[0]!.acceptance_rate_segment).toBeUndefined();
    expect(state.psps[0]!.recent_segment_outcomes).toBeUndefined();
  });

  it("level 2 adds segment acceptance with its sample size, still no recent outcomes", () => {
    const state = buildJevState({ tx, eligible: [alpha], observed: { alpha: stats }, dataRichnessLevel: 2 });
    expect(state.psps[0]!.acceptance_rate_segment).toBe(0.88);
    expect(state.psps[0]!.acceptance_rate_segment_sample_size).toBe(30);
    expect(state.psps[0]!.recent_segment_outcomes).toBeUndefined();
  });

  it("level 3 adds recent outcomes as authorized/declined strings, most-recent-first order preserved", () => {
    const state = buildJevState({
      tx,
      eligible: [alpha],
      observed: { alpha: stats },
      recentSegmentOutcomes: { alpha: [true, true, false] },
      dataRichnessLevel: 3,
    });
    expect(state.psps[0]!.recent_segment_outcomes).toEqual(["authorized", "authorized", "declined"]);
  });

  it("computes the derived expected fee from the PSP's own exact config and this transaction's amount", () => {
    const state = buildJevState({ tx, eligible: [alpha], observed: { alpha: stats }, dataRichnessLevel: 1 });
    // 60 * 1.3% + 0.25 = 0.78 + 0.25 = 1.03
    expect(state.psps[0]!.expected_fee_eur).toBeCloseTo(1.03, 10);
  });

  it("represents missing observed data as null with sample size 0, never invents a value", () => {
    const state = buildJevState({ tx, eligible: [alpha], observed: {}, dataRichnessLevel: 2 });
    const p = state.psps[0]!;
    expect(p.acceptance_rate_overall).toBeNull();
    expect(p.acceptance_rate_overall_sample_size).toBe(0);
    expect(p.acceptance_rate_segment).toBeNull();
    expect(p.acceptance_rate_segment_sample_size).toBe(0);
  });
});
