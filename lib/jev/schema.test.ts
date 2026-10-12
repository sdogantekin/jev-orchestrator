import { describe, expect, it } from "vitest";
import type { PspConfig } from "../domain/psp.js";
import { buildDecisionSchema, METRIC_DEFINITIONS } from "./schema.js";

function psp(id: PspConfig["id"], role: string): PspConfig {
  return {
    id,
    name: `PSP ${id}`,
    role,
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

describe("buildDecisionSchema", () => {
  it("generates options only from the eligible PSPs given, never a hardcoded set", () => {
    const schema = buildDecisionSchema([psp("alpha", "Generalist")]);
    expect(schema.options.map((o) => o.id)).toEqual(["alpha"]);

    const schemaTwo = buildDecisionSchema([psp("beta", "EU specialist"), psp("gamma", "Cheap and fast")]);
    expect(schemaTwo.options.map((o) => o.id)).toEqual(["beta", "gamma"]);
  });

  it("is a choice-type decision with a question and objective", () => {
    const schema = buildDecisionSchema([psp("alpha", "Generalist")]);
    expect(schema.type).toBe("choice");
    expect(schema.question.length).toBeGreaterThan(0);
    expect(schema.objective.length).toBeGreaterThan(0);
  });

  it("includes every metric referenced by state.ts's PSP fields", () => {
    const ids = METRIC_DEFINITIONS.map((m) => m.id);
    for (const expected of [
      "acceptance_rate_overall",
      "acceptance_rate_segment",
      "availability_rate_overall",
      "chargeback_rate_overall",
      "average_latency_ms",
      "retry_success_rate",
      "fixed_fee_eur",
      "cost_percent",
      "expected_fee_eur",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("describes each option with the PSP's name and general role, not a hidden world value", () => {
    const schema = buildDecisionSchema([psp("beta", "EU specialist")]);
    expect(schema.options[0]!.description).toBe("PSP beta — EU specialist.");
  });
});
