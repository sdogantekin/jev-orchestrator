import { describe, expect, it } from "vitest";
import type { PspConfig } from "../domain/psp.js";
import type { PspId, Transaction } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";
import { createRuleRouter, DEFAULT_RULE_PARAMS, type RuleParams } from "./ruleRouter.js";
import type { RouterInput } from "./types.js";

function psp(id: PspId, overrides: Partial<PspConfig> = {}): PspConfig {
  return {
    id,
    name: id,
    role: "role",
    enabled: true,
    supportedCurrencies: ["EUR", "GBP", "USD"],
    supportedPaymentMethods: ["card", "paypal", "sepa_debit"],
    baseAcceptanceRate: 0.9,
    transactionCostPercent: 1,
    fixedFee: 0.2,
    retrySuccessRate: 0.3,
    chargebackRate: 0.001,
    latencyCentralMs: 300,
    availabilityRate: 0.99,
    ...overrides,
  };
}

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

function stats(overrides: Partial<ObservedPspStats> = {}): ObservedPspStats {
  return {
    pspId: "alpha",
    acceptanceOverall: { value: 0.9, sampleSize: 100 },
    acceptanceSegment: { value: 0.9, sampleSize: 20 },
    availabilityOverall: { value: 0.999, sampleSize: 100 },
    chargebackOverall: { value: 0.002, sampleSize: 90 },
    averageLatencyMs: { value: 300, sampleSize: 100 },
    retrySuccessRate: 0.3,
    ...overrides,
  };
}

const allThree = [psp("alpha"), psp("beta"), psp("gamma")];
const safeObserved: Partial<Record<PspId, ObservedPspStats>> = {
  alpha: stats({ pspId: "alpha" }),
  beta: stats({ pspId: "beta" }),
  gamma: stats({ pspId: "gamma" }),
};

const r1 = createRuleRouter(DEFAULT_RULE_PARAMS);

function run(input: Partial<RouterInput>): PspId {
  return r1({ tx: tx(), eligible: allThree, observed: safeObserved, ...input });
}

describe("R1 rule list", () => {
  it("rule 2: EUR + card + DE/NL/FR prefers Beta", () => {
    for (const country of ["DE", "NL", "FR"] as const) {
      expect(run({ tx: tx({ currency: "EUR", paymentMethod: "card", country }) })).toBe("beta");
    }
  });

  it("rule 2 does not fire outside EUR/card/DE-NL-FR", () => {
    expect(run({ tx: tx({ currency: "EUR", paymentMethod: "card", country: "UK" }) })).not.toBe("beta");
    expect(run({ tx: tx({ currency: "EUR", paymentMethod: "paypal", country: "DE" }) })).not.toBe("beta");
  });

  it("rule 3: USD prefers Alpha", () => {
    expect(run({ tx: tx({ currency: "USD", country: "US" }) })).toBe("alpha");
  });

  it("rule 4: large amount prefers the eligible PSP with highest observed acceptance", () => {
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", acceptanceOverall: { value: 0.80, sampleSize: 100 } }),
      beta: stats({ pspId: "beta", acceptanceOverall: { value: 0.95, sampleSize: 100 } }),
      gamma: stats({ pspId: "gamma", acceptanceOverall: { value: 0.85, sampleSize: 100 } }),
    };
    expect(run({ tx: tx({ currency: "GBP", country: "UK", amount: 600 }), observed })).toBe("beta");
  });

  it("rule 5: small amount prefers the eligible PSP with the lowest fixed fee", () => {
    const eligible = [psp("alpha", { fixedFee: 0.25 }), psp("beta", { fixedFee: 0.2 }), psp("gamma", { fixedFee: 0.15 })];
    expect(run({ tx: tx({ currency: "GBP", country: "UK", amount: 10 }), eligible })).toBe("gamma");
  });

  it("rule 6: otherwise falls back to the default preference (Alpha)", () => {
    expect(run({ tx: tx({ currency: "GBP", country: "UK", amount: 60 }) })).toBe("alpha");
  });

  it("rule 7: overrides an eligible-but-unsafe preference with the highest-acceptance eligible PSP", () => {
    // USD -> prefers Alpha (rule 3), but Alpha's observed acceptance is below the safety threshold.
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", acceptanceOverall: { value: 0.80, sampleSize: 100 } }),
      beta: stats({ pspId: "beta", acceptanceOverall: { value: 0.92, sampleSize: 100 } }),
      gamma: stats({ pspId: "gamma", acceptanceOverall: { value: 0.85, sampleSize: 100 } }),
    };
    expect(run({ tx: tx({ currency: "USD", country: "US" }), observed })).toBe("beta");
  });

  it("rule 7: also triggers on low observed availability even with high acceptance", () => {
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", availabilityOverall: { value: 0.95, sampleSize: 100 } }),
      beta: stats({ pspId: "beta", acceptanceOverall: { value: 0.92, sampleSize: 100 } }),
      gamma: stats({ pspId: "gamma" }),
    };
    expect(run({ tx: tx({ currency: "USD", country: "US" }), observed })).toBe("beta");
  });

  it("rule 8: replaces a preferred-but-ineligible PSP with the highest-acceptance eligible PSP", () => {
    // EUR/card/DE prefers Beta (rule 2), but Beta is not eligible here.
    const eligible = [psp("alpha"), psp("gamma")];
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", acceptanceOverall: { value: 0.80, sampleSize: 100 } }),
      gamma: stats({ pspId: "gamma", acceptanceOverall: { value: 0.90, sampleSize: 100 } }),
    };
    expect(run({ tx: tx({ currency: "EUR", paymentMethod: "card", country: "DE" }), eligible, observed })).toBe("gamma");
  });

  it("treats a PSP with no observed data yet as never winning a highest-acceptance comparison", () => {
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", acceptanceOverall: { value: null, sampleSize: 0 } }),
      beta: stats({ pspId: "beta", acceptanceOverall: { value: 0.5, sampleSize: 10 } }),
      gamma: stats({ pspId: "gamma", acceptanceOverall: { value: null, sampleSize: 0 } }),
    };
    expect(run({ tx: tx({ currency: "GBP", country: "UK", amount: 600 }), observed })).toBe("beta");
  });
});

describe("ties break by observed chargeback rate, lower is better", () => {
  it("rule 4: an exact acceptance tie prefers the lower observed chargeback rate", () => {
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", acceptanceOverall: { value: 0.9, sampleSize: 100 }, chargebackOverall: { value: 0.003, sampleSize: 90 } }),
      beta: stats({ pspId: "beta", acceptanceOverall: { value: 0.9, sampleSize: 100 }, chargebackOverall: { value: 0.001, sampleSize: 90 } }),
      gamma: stats({ pspId: "gamma", acceptanceOverall: { value: 0.7, sampleSize: 100 } }),
    };
    expect(run({ tx: tx({ currency: "GBP", country: "UK", amount: 600 }), observed })).toBe("beta");
  });

  it("rule 5: an exact fee tie prefers the lower observed chargeback rate", () => {
    const eligible = [psp("alpha", { fixedFee: 0.2 }), psp("beta", { fixedFee: 0.2 }), psp("gamma", { fixedFee: 0.3 })];
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", chargebackOverall: { value: 0.004, sampleSize: 90 } }),
      beta: stats({ pspId: "beta", chargebackOverall: { value: 0.001, sampleSize: 90 } }),
      gamma: stats({ pspId: "gamma" }),
    };
    expect(run({ tx: tx({ currency: "GBP", country: "UK", amount: 10 }), eligible, observed })).toBe("beta");
  });

  it("falls back to canonical PSP order when chargeback rate is also tied", () => {
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", acceptanceOverall: { value: 0.9, sampleSize: 100 } }),
      beta: stats({ pspId: "beta", acceptanceOverall: { value: 0.9, sampleSize: 100 } }),
      gamma: stats({ pspId: "gamma", acceptanceOverall: { value: 0.7, sampleSize: 100 } }),
    };
    expect(run({ tx: tx({ currency: "GBP", country: "UK", amount: 600 }), observed })).toBe("alpha");
  });
});

describe("R2 reuses the same structure with different parameters", () => {
  const tunedParams: RuleParams = {
    ...DEFAULT_RULE_PARAMS,
    preferredForEuCard: "gamma",
    largeThreshold: 300,
  };
  const r2 = createRuleRouter(tunedParams);

  it("applies the tuned preferred PSP for rule 2", () => {
    const result = r2({ tx: tx({ currency: "EUR", paymentMethod: "card", country: "NL" }), eligible: allThree, observed: safeObserved });
    expect(result).toBe("gamma");
  });

  it("applies the tuned large-amount threshold", () => {
    const observed: Partial<Record<PspId, ObservedPspStats>> = {
      alpha: stats({ pspId: "alpha", acceptanceOverall: { value: 0.95, sampleSize: 100 } }),
      beta: stats({ pspId: "beta", acceptanceOverall: { value: 0.80, sampleSize: 100 } }),
      gamma: stats({ pspId: "gamma", acceptanceOverall: { value: 0.80, sampleSize: 100 } }),
    };
    // amount=350 is "large" under the tuned threshold (300) but would be "medium" under R1's (500)
    const result = r2({ tx: tx({ currency: "GBP", country: "UK", amount: 350 }), eligible: allThree, observed });
    expect(result).toBe("alpha");
  });
});
