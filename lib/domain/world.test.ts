import { describe, expect, it } from "vitest";
import type { PspConfig } from "./psp.js";
import type { Transaction } from "./types.js";
import { worldAcceptanceRate, type WorldConfig } from "./world.js";

const psps: PspConfig[] = [
  {
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
  },
  {
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
  },
  {
    id: "gamma",
    name: "PSP Gamma",
    role: "Cheap and fast",
    enabled: true,
    supportedCurrencies: ["EUR", "GBP", "USD"],
    supportedPaymentMethods: ["card", "sepa_debit"],
    baseAcceptanceRate: 0.92,
    transactionCostPercent: 0.9,
    fixedFee: 0.15,
    retrySuccessRate: 0.42,
    chargebackRate: 0.0015,
    latencyCentralMs: 250,
    availabilityRate: 0.9995,
  },
];

const world: WorldConfig = {
  psps,
  segmentModifiers: [
    { pspId: "beta", description: "EUR card DE/NL", delta: 0.045, when: { currency: "EUR", paymentMethod: "card", countryIn: ["DE", "NL"] } },
    { pspId: "beta", description: "USD", delta: -0.05, when: { currency: "USD" } },
    { pspId: "beta", description: "new on mobile", delta: -0.02, when: { customerType: "new", device: "mobile" } },
    { pspId: "gamma", description: "large + 3DS", delta: 0.03, when: { amountBucket: "large", threeDsEligible: true } },
    { pspId: "gamma", description: "small", delta: -0.02, when: { amountBucket: "small" } },
  ],
  drift: null,
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

describe("worldAcceptanceRate", () => {
  it("returns the base rate with no matching modifiers", () => {
    expect(worldAcceptanceRate(world, "alpha", tx({ country: "US", currency: "USD" }), 0)).toBeCloseTo(0.945, 10);
  });

  it("applies Beta's EUR/card/DE-or-NL bonus", () => {
    expect(worldAcceptanceRate(world, "beta", tx({ currency: "EUR", paymentMethod: "card", country: "DE" }), 0)).toBeCloseTo(0.975, 10);
    expect(worldAcceptanceRate(world, "beta", tx({ currency: "EUR", paymentMethod: "card", country: "NL" }), 0)).toBeCloseTo(0.975, 10);
    // FR is not in the bonus list even though R1 treats DE/NL/FR alike
    expect(worldAcceptanceRate(world, "beta", tx({ currency: "EUR", paymentMethod: "card", country: "FR" }), 0)).toBeCloseTo(0.93, 10);
  });

  it("applies Beta's USD penalty", () => {
    expect(worldAcceptanceRate(world, "beta", tx({ currency: "USD", country: "US" }), 0)).toBeCloseTo(0.88, 10);
  });

  it("stacks multiple matching modifiers for the same PSP", () => {
    // USD (-0.05) and new-on-mobile (-0.02) both apply: 0.93 - 0.05 - 0.02 = 0.86
    const t = tx({ currency: "USD", country: "US", customerType: "new", device: "mobile" });
    expect(worldAcceptanceRate(world, "beta", t, 0)).toBeCloseTo(0.86, 10);
  });

  it("applies Gamma's large+3DS bonus and small penalty", () => {
    expect(worldAcceptanceRate(world, "gamma", tx({ amountBucket: "large", threeDsEligible: true }), 0)).toBeCloseTo(0.95, 10);
    expect(worldAcceptanceRate(world, "gamma", tx({ amountBucket: "small" }), 0)).toBeCloseTo(0.90, 10);
  });

  it("clamps to [0, 1]", () => {
    const extreme: WorldConfig = {
      ...world,
      segmentModifiers: [{ pspId: "alpha", description: "huge boost", delta: 0.5, when: {} }],
    };
    expect(worldAcceptanceRate(extreme, "alpha", tx(), 0)).toBe(1);
  });

  it("applies drift only at and after the start index", () => {
    const drifted: WorldConfig = { ...world, drift: { startIndex: 600, pspId: "beta", acceptanceDelta: -0.08 } };
    expect(worldAcceptanceRate(drifted, "beta", tx({ country: "FR" }), 599)).toBeCloseTo(0.93, 10);
    expect(worldAcceptanceRate(drifted, "beta", tx({ country: "FR" }), 600)).toBeCloseTo(0.85, 10);
    expect(worldAcceptanceRate(drifted, "beta", tx({ country: "FR" }), 999)).toBeCloseTo(0.85, 10);
  });

  it("does not drift a PSP other than the one named in the drift config", () => {
    const drifted: WorldConfig = { ...world, drift: { startIndex: 600, pspId: "beta", acceptanceDelta: -0.08 } };
    expect(worldAcceptanceRate(drifted, "alpha", tx(), 999)).toBeCloseTo(0.945, 10);
  });
});
