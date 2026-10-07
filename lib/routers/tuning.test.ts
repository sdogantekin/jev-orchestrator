import { describe, expect, it } from "vitest";
import { loadCurrencyConversion, loadStreamConfig, loadWorldConfig } from "../simulation/configLoader.js";
import { DEFAULT_RULE_PARAMS } from "./ruleRouter.js";
import { enumerateGrid, tuneR2, type GridSearchSpace } from "./tuning.js";

const baseWorld = loadWorldConfig();
const baseStream = loadStreamConfig();
const rates = loadCurrencyConversion();

describe("enumerateGrid", () => {
  it("yields the cartesian product of every axis", () => {
    const space: GridSearchSpace = {
      preferredForEuCard: ["alpha", "beta"],
      preferredForUsd: ["alpha"],
      preferredDefault: ["alpha"],
      largeThreshold: [500],
      smallThreshold: [25],
      safetyAvailabilityThreshold: [0.99],
      safetyAcceptanceThreshold: [0.88],
    };
    const combos = [...enumerateGrid(space)];
    expect(combos.length).toBe(2);
    expect(combos.map((c) => c.preferredForEuCard).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("tuneR2", () => {
  it("picks the preferredForUsd that clearly maximizes training-slice authorization rate", () => {
    // All three PSPs have a solid base acceptance (comfortably above R1's 0.88 safety
    // threshold, so the safety fallback never overrides the rule-driven preference), but
    // Gamma gets a further boost specifically on USD transactions. Only rule 3 (USD) is
    // exercised by the tuned axis here, so the rest of the training slice routes identically
    // under either candidate and the comparison isolates rule 3's effect.
    const riggedWorld = {
      ...baseWorld,
      segmentModifiers: [{ pspId: "gamma" as const, description: "USD boost for this test", delta: 0.07, when: { currency: "USD" as const } }],
      psps: baseWorld.psps.map((p) => ({ ...p, baseAcceptanceRate: 0.92, availabilityRate: 1 })),
    };
    const scenario = { world: riggedWorld, stream: baseStream, observedView: { lag: 50, window: 150, backgroundHistoryLimits: [] } };

    const tinyGrid: GridSearchSpace = {
      preferredForEuCard: [DEFAULT_RULE_PARAMS.preferredForEuCard],
      preferredForUsd: ["alpha", "gamma"],
      preferredDefault: [DEFAULT_RULE_PARAMS.preferredDefault],
      largeThreshold: [DEFAULT_RULE_PARAMS.largeThreshold],
      smallThreshold: [DEFAULT_RULE_PARAMS.smallThreshold],
      safetyAvailabilityThreshold: [DEFAULT_RULE_PARAMS.safetyAvailabilityThreshold],
      safetyAcceptanceThreshold: [DEFAULT_RULE_PARAMS.safetyAcceptanceThreshold],
    };

    const tuned = tuneR2(scenario, "tuning-test-scenario", rates, tinyGrid);
    expect(tuned.preferredForUsd).toBe("gamma");
  });

  it("is deterministic for the same scenario and tuning seed", () => {
    const scenario = { world: baseWorld, stream: baseStream, observedView: { lag: 50, window: 150, backgroundHistoryLimits: [] } };
    const tinyGrid: GridSearchSpace = {
      preferredForEuCard: ["alpha", "beta"],
      preferredForUsd: ["alpha", "beta"],
      preferredDefault: ["alpha"],
      largeThreshold: [500],
      smallThreshold: [25],
      safetyAvailabilityThreshold: [0.99],
      safetyAcceptanceThreshold: [0.88],
    };
    const a = tuneR2(scenario, "determinism-test-scenario", rates, tinyGrid);
    const b = tuneR2(scenario, "determinism-test-scenario", rates, tinyGrid);
    expect(a).toEqual(b);
  });
});
