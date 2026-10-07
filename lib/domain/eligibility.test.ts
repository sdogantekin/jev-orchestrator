import { describe, expect, it } from "vitest";
import { checkEligibility, eligiblePsps } from "./eligibility.js";
import type { PspConfig } from "./psp.js";
import type { Transaction } from "./types.js";

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

const gamma: PspConfig = {
  ...alpha,
  id: "gamma",
  name: "PSP Gamma",
  supportedPaymentMethods: ["card", "sepa_debit"],
};

function tx(overrides: Partial<Transaction> = {}): Transaction {
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

describe("checkEligibility", () => {
  it("is eligible when currency and payment method are supported and the PSP is enabled", () => {
    expect(checkEligibility(alpha, tx())).toEqual({ pspId: "alpha", eligible: true, reasons: [] });
  });

  it("excludes a disabled PSP", () => {
    const result = checkEligibility({ ...alpha, enabled: false }, tx());
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("disabled");
  });

  it("excludes an unsupported currency", () => {
    const result = checkEligibility({ ...alpha, supportedCurrencies: ["GBP", "USD"] }, tx());
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["currency_unsupported"]);
  });

  it("excludes an unsupported payment method (PSP Gamma does not support PayPal)", () => {
    const result = checkEligibility(gamma, tx({ paymentMethod: "paypal" }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(["payment_method_unsupported"]);
  });

  it("can report multiple simultaneous reasons", () => {
    const result = checkEligibility(
      { ...alpha, enabled: false, supportedCurrencies: ["USD"] },
      tx({ currency: "EUR" })
    );
    expect(result.reasons).toEqual(["disabled", "currency_unsupported"]);
  });
});

describe("eligiblePsps", () => {
  it("filters to only the eligible PSPs, preserving order", () => {
    const result = eligiblePsps([alpha, gamma], tx({ paymentMethod: "paypal" }));
    expect(result.map((p) => p.id)).toEqual(["alpha"]);
  });

  it("returns an empty list when every PSP is disabled", () => {
    const result = eligiblePsps([{ ...alpha, enabled: false }, { ...gamma, enabled: false }], tx());
    expect(result).toEqual([]);
  });
});
