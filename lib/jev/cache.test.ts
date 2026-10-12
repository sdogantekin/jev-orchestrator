import { describe, expect, it } from "vitest";
import type { DecisionsApiRequest } from "./request.js";
import { createInMemoryCache, hashDecisionRequest } from "./cache.js";

function request(overrides: Partial<DecisionsApiRequest> = {}): DecisionsApiRequest {
  return {
    model: "typesafe/jev-1.13",
    state: { transaction: { amount_eur: 60, currency: "EUR" } as never, psps: [{ id: "alpha" } as never] },
    questions: { psp_selection: { type: "choice", instructions: "x", criteria: { alpha: "a", beta: "b" } } },
    ...overrides,
  };
}

describe("hashDecisionRequest", () => {
  it("is deterministic for the same request", () => {
    expect(hashDecisionRequest(request())).toBe(hashDecisionRequest(request()));
  });

  it("is independent of object key insertion order", () => {
    const a = { model: "typesafe/jev-1.13", state: { b: 1, a: 2 }, questions: {} } as unknown as DecisionsApiRequest;
    const b = { state: { a: 2, b: 1 }, model: "typesafe/jev-1.13", questions: {} } as unknown as DecisionsApiRequest;
    expect(hashDecisionRequest(a)).toBe(hashDecisionRequest(b));
  });

  it("changes when the model changes", () => {
    const a = hashDecisionRequest(request({ model: "typesafe/jev-1.13" }));
    const b = hashDecisionRequest(request({ model: "typesafe/jev-1.14" }));
    expect(a).not.toBe(b);
  });

  it("changes when the state changes", () => {
    const a = hashDecisionRequest(request());
    const b = hashDecisionRequest(request({ state: { transaction: { amount_eur: 61 } as never, psps: [] } }));
    expect(a).not.toBe(b);
  });
});

describe("createInMemoryCache", () => {
  it("returns undefined for a missing key, then the stored entry after set", () => {
    const cache = createInMemoryCache();
    expect(cache.get("missing")).toBeUndefined();
    const response = { model: "typesafe/jev-1.13", answers: {} };
    cache.set("key", { response });
    expect(cache.get("key")).toEqual({ response });
  });
});
