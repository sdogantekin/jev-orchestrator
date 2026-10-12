import { describe, expect, it } from "vitest";
import { DecisionsApiResponseSchema } from "./response.js";

describe("DecisionsApiResponseSchema", () => {
  it("accepts a well-formed choice response with confidence and usage", () => {
    const result = DecisionsApiResponseSchema.safeParse({
      model: "typesafe/jev-1.13-2026-09-18",
      answers: {
        psp_selection: {
          type: "choice",
          choice: "beta",
          probabilities: { alpha: 0.1, beta: 0.85, gamma: 0.05 },
          confidence: 0.9,
        },
      },
      usage: { input_tokens: 500, output_tokens: 40, cost: 0.00002 },
      id: "gen-dec-123",
      provider: "TypeSafe",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a response with confidence absent (section 8.5.4: never invent one)", () => {
    const result = DecisionsApiResponseSchema.safeParse({
      model: "typesafe/jev-1.13",
      answers: {
        psp_selection: { type: "choice", choice: "alpha", probabilities: { alpha: 1 } },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.answers.psp_selection!.confidence).toBeUndefined();
    }
  });

  it("rejects a response missing the required `choice` field", () => {
    const result = DecisionsApiResponseSchema.safeParse({
      model: "typesafe/jev-1.13",
      answers: { psp_selection: { type: "choice", probabilities: { alpha: 1 } } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a confidence value outside [0, 1]", () => {
    const result = DecisionsApiResponseSchema.safeParse({
      model: "typesafe/jev-1.13",
      answers: {
        psp_selection: { type: "choice", choice: "alpha", probabilities: { alpha: 1 }, confidence: 1.5 },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-object body entirely (e.g. a raw string)", () => {
    const result = DecisionsApiResponseSchema.safeParse("not a response");
    expect(result.success).toBe(false);
  });

  it("rejects an answer of the wrong type for this adapter (e.g. noul instead of choice)", () => {
    const result = DecisionsApiResponseSchema.safeParse({
      model: "typesafe/jev-1.13",
      answers: { psp_selection: { type: "noul", noul: 0.5 } },
    });
    expect(result.success).toBe(false);
  });
});
