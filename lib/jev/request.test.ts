import { describe, expect, it } from "vitest";
import type { PspConfig } from "../domain/psp.js";
import { buildDecisionsRequest } from "./request.js";
import { buildDecisionSchema, PSP_SELECTION_DECISION_ID } from "./schema.js";
import type { JevState } from "./state.js";

const alpha: PspConfig = {
  id: "alpha",
  name: "PSP Alpha",
  role: "Generalist",
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
const beta: PspConfig = { ...alpha, id: "beta", name: "PSP Beta", role: "EU specialist" };

const fakeState: JevState = {
  transaction: {
    amount_eur: 60,
    currency: "EUR",
    country: "DE",
    payment_method: "card",
    card_scheme: "visa",
    device: "desktop",
    customer_type: "returning",
    three_ds_eligible: false,
    amount_bucket: "medium",
  },
  psps: [],
};

describe("buildDecisionsRequest", () => {
  it("uses the given model, unmodified", () => {
    const schema = buildDecisionSchema([alpha]);
    const request = buildDecisionsRequest(schema, fakeState, "typesafe/jev-1.13");
    expect(request.model).toBe("typesafe/jev-1.13");
  });

  it("passes the state through unchanged", () => {
    const schema = buildDecisionSchema([alpha]);
    const request = buildDecisionsRequest(schema, fakeState, "typesafe/jev-1.13");
    expect(request.state).toBe(fakeState);
  });

  it("keys the single question by the schema's decision id, typed as choice", () => {
    const schema = buildDecisionSchema([alpha, beta]);
    const request = buildDecisionsRequest(schema, fakeState, "typesafe/jev-1.13");
    const question = request.questions[PSP_SELECTION_DECISION_ID];
    expect(question).toBeDefined();
    expect(question!.type).toBe("choice");
  });

  it("builds criteria from exactly the schema's options, keyed by PSP id", () => {
    const schema = buildDecisionSchema([alpha, beta]);
    const request = buildDecisionsRequest(schema, fakeState, "typesafe/jev-1.13");
    const criteria = request.questions[PSP_SELECTION_DECISION_ID]!.criteria;
    expect(Object.keys(criteria).sort()).toEqual(["alpha", "beta"]);
    expect(criteria.alpha).toBe("PSP Alpha — Generalist.");
  });

  it("embeds the question, objective and metric glossary in the instructions text", () => {
    const schema = buildDecisionSchema([alpha]);
    const request = buildDecisionsRequest(schema, fakeState, "typesafe/jev-1.13");
    const instructions = request.questions[PSP_SELECTION_DECISION_ID]!.instructions;
    expect(instructions).toContain(schema.question);
    expect(instructions).toContain(schema.objective);
    expect(instructions).toContain("acceptance_rate_overall");
  });
});
