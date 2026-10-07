import { describe, expect, it } from "vitest";
import { chargebackLossEUR, computeNetCost, feeEUR } from "./fees.js";
import type { PspConfig } from "./psp.js";

const beta: PspConfig = {
  id: "beta",
  name: "PSP Beta",
  role: "EU specialist",
  enabled: true,
  supportedCurrencies: ["EUR", "GBP", "USD"],
  supportedPaymentMethods: ["card", "paypal", "sepa_debit"],
  baseAcceptanceRate: 0.93,
  transactionCostPercent: 1.1,
  fixedFee: 0.2,
  retrySuccessRate: 0.38,
  chargebackRate: 0.0021,
  latencyCentralMs: 290,
  availabilityRate: 0.998,
};

describe("feeEUR", () => {
  it("computes amount * cost% + fixed fee", () => {
    // 100 * 1.1% + 0.20 = 1.10 + 0.20 = 1.30
    expect(feeEUR(beta, 100)).toBeCloseTo(1.3, 10);
  });

  it("is zero-amount safe", () => {
    expect(feeEUR(beta, 0)).toBeCloseTo(beta.fixedFee, 10);
  });
});

describe("chargebackLossEUR", () => {
  it("is amount plus the fixed chargeback fee, default 15", () => {
    expect(chargebackLossEUR(100)).toBe(115);
  });

  it("honors a configured fixed chargeback fee", () => {
    expect(chargebackLossEUR(100, 20)).toBe(120);
  });
});

describe("computeNetCost", () => {
  it("is zero when not authorized (no fee, no chargeback)", () => {
    const cost = computeNetCost({ authorized: false, chargeback: false, psp: beta, amountEUR: 100 });
    expect(cost).toEqual({ feeEUR: 0, chargebackLossEUR: 0, netCostEUR: 0 });
  });

  it("charges only the fee when authorized without a chargeback", () => {
    const cost = computeNetCost({ authorized: true, chargeback: false, psp: beta, amountEUR: 100 });
    expect(cost.feeEUR).toBeCloseTo(1.3, 10);
    expect(cost.chargebackLossEUR).toBe(0);
    expect(cost.netCostEUR).toBeCloseTo(1.3, 10);
  });

  it("adds the chargeback loss on top of the fee when a chargeback occurs", () => {
    const cost = computeNetCost({ authorized: true, chargeback: true, psp: beta, amountEUR: 100 });
    expect(cost.feeEUR).toBeCloseTo(1.3, 10);
    expect(cost.chargebackLossEUR).toBe(115);
    expect(cost.netCostEUR).toBeCloseTo(116.3, 10);
  });

  it("never charges a chargeback loss when not authorized, even if chargeback=true is passed", () => {
    const cost = computeNetCost({ authorized: false, chargeback: true, psp: beta, amountEUR: 100 });
    expect(cost.netCostEUR).toBe(0);
  });
});
