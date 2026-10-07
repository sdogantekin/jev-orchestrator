import { describe, expect, it } from "vitest";
import type { PspConfig } from "../domain/psp.js";
import { naiveRouter } from "./naive.js";

function psp(id: PspConfig["id"]): PspConfig {
  return {
    id,
    name: id,
    role: "role",
    enabled: true,
    supportedCurrencies: ["EUR"],
    supportedPaymentMethods: ["card"],
    baseAcceptanceRate: 0.9,
    transactionCostPercent: 1,
    fixedFee: 0.2,
    retrySuccessRate: 0.3,
    chargebackRate: 0.001,
    latencyCentralMs: 300,
    availabilityRate: 0.99,
  };
}

describe("naiveRouter", () => {
  it("picks Alpha when Alpha is eligible, regardless of order", () => {
    expect(naiveRouter({ tx: {} as never, eligible: [psp("gamma"), psp("alpha"), psp("beta")], observed: {} as never })).toBe("alpha");
  });

  it("picks the first eligible PSP when Alpha is not eligible", () => {
    expect(naiveRouter({ tx: {} as never, eligible: [psp("beta"), psp("gamma")], observed: {} as never })).toBe("beta");
    expect(naiveRouter({ tx: {} as never, eligible: [psp("gamma")], observed: {} as never })).toBe("gamma");
  });

  it("throws when called with no eligible PSPs (should never happen; eligibility is checked upstream)", () => {
    expect(() => naiveRouter({ tx: {} as never, eligible: [], observed: {} as never })).toThrow();
  });
});
