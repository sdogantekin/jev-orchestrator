import { describe, expect, it } from "vitest";
import type { PspConfig } from "../domain/psp.js";
import type { PspId, Transaction } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";
import { statsReferenceRouter } from "./statsReference.js";

function psp(id: PspId, fixedFee = 0.2): PspConfig {
  return {
    id, name: id, role: "role", enabled: true,
    supportedCurrencies: ["EUR"], supportedPaymentMethods: ["card"],
    baseAcceptanceRate: 0.9, transactionCostPercent: 1, fixedFee,
    retrySuccessRate: 0.3, chargebackRate: 0.001, latencyCentralMs: 300, availabilityRate: 0.99,
  };
}

function stats(id: PspId, overall: number, segment: number | null, segmentN: number): ObservedPspStats {
  return {
    pspId: id,
    acceptanceOverall: { value: overall, sampleSize: 3000 },
    acceptanceSegment: { value: segment, sampleSize: segmentN },
    availabilityOverall: { value: 0.999, sampleSize: 3000 },
    chargebackOverall: { value: 0.002, sampleSize: 2800 },
    averageLatencyMs: { value: 300, sampleSize: 3000 },
    retrySuccessRate: 0.3,
  };
}

const tx = { amountEUR: 60 } as Transaction;

describe("statsReferenceRouter", () => {
  it("does not trust a perfect segment score built on two attempts", () => {
    const observed = { alpha: stats("alpha", 0.94, 0.93, 400), beta: stats("beta", 0.92, 1.0, 2) };
    expect(statsReferenceRouter({ tx, eligible: [psp("alpha"), psp("beta")], observed })).toBe("alpha");
  });

  it("follows a segment difference backed by plenty of attempts", () => {
    const observed = { alpha: stats("alpha", 0.94, 0.9, 500), beta: stats("beta", 0.92, 0.97, 500) };
    expect(statsReferenceRouter({ tx, eligible: [psp("alpha"), psp("beta")], observed })).toBe("beta");
  });

  it("falls back to the overall rate when the segment has no data", () => {
    const observed = { alpha: stats("alpha", 0.94, null, 0), beta: stats("beta", 0.92, null, 0) };
    expect(statsReferenceRouter({ tx, eligible: [psp("alpha"), psp("beta")], observed })).toBe("alpha");
  });

  it("breaks an exact tie by the lower fee", () => {
    const observed = { alpha: stats("alpha", 0.94, 0.94, 100), beta: stats("beta", 0.94, 0.94, 100) };
    expect(statsReferenceRouter({ tx, eligible: [psp("alpha", 0.25), psp("beta", 0.15)], observed })).toBe("beta");
  });
});
