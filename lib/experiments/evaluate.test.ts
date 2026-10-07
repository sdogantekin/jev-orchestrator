import { describe, expect, it } from "vitest";
import { loadCurrencyConversion, loadStreamConfig, loadWorldConfig } from "../simulation/configLoader.js";
import { naiveRouter } from "../routers/naive.js";
import { r1Router } from "../routers/ruleRouter.js";
import { generateStream } from "../simulation/stream.js";
import { evaluateRouters } from "./evaluate.js";

const baseWorld = loadWorldConfig();
const baseStream = loadStreamConfig();
const rates = loadCurrencyConversion();
const scenario = { world: baseWorld, stream: baseStream, observedView: { lag: 50, window: 150, backgroundHistoryLimits: [] } };

describe("evaluateRouters", () => {
  it("accounts for every transaction in range as exactly one of: decision, single-eligible, zero-eligible", () => {
    const rangeStart = 100;
    const rangeEnd = 199;
    const { decisionsByRouter, singleEligibleCount, zeroEligibleCount } = evaluateRouters({
      scenario,
      seed: "evaluate-accounting",
      streamLength: 300,
      rangeStart,
      rangeEnd,
      conversionRates: rates,
      routers: { R0: naiveRouter },
    });
    const total = decisionsByRouter.R0!.length + singleEligibleCount + zeroEligibleCount;
    expect(total).toBe(rangeEnd - rangeStart + 1);
    // All three PSPs support all currencies, so zero-eligible should never happen in the base world.
    expect(zeroEligibleCount).toBe(0);
  });

  it("R0 always chooses Alpha when Alpha is eligible, and never Alpha when it is not (SEPA Debit)", () => {
    const seed = "evaluate-r0";
    const streamLength = 300;
    const { decisionsByRouter } = evaluateRouters({
      scenario,
      seed,
      streamLength,
      rangeStart: 100,
      rangeEnd: 199,
      conversionRates: rates,
      routers: { R0: naiveRouter },
    });
    const stream = generateStream(seed, streamLength, baseStream, rates);
    let sawIneligibleAlpha = false;
    for (const d of decisionsByRouter.R0!) {
      const tx = stream[d.transactionIndex]!;
      if (tx.paymentMethod === "sepa_debit") {
        sawIneligibleAlpha = true;
        expect(d.chosenPspId).not.toBe("alpha");
      } else {
        expect(d.chosenPspId).toBe("alpha");
      }
    }
    expect(sawIneligibleAlpha).toBe(true);
  });

  it("common random numbers: whenever two routers land on the same PSP for the same transaction, their outcomes are identical", () => {
    const { decisionsByRouter } = evaluateRouters({
      scenario,
      seed: "evaluate-crn",
      streamLength: 500,
      rangeStart: 100,
      rangeEnd: 399,
      conversionRates: rates,
      routers: { R0: naiveRouter, R1: r1Router },
    });
    const r0 = decisionsByRouter.R0!;
    const r1 = decisionsByRouter.R1!;
    expect(r0.length).toBe(r1.length);

    let agreementsChecked = 0;
    for (let i = 0; i < r0.length; i++) {
      if (r0[i]!.chosenPspId === r1[i]!.chosenPspId) {
        agreementsChecked++;
        expect(r1[i]!.authorized).toBe(r0[i]!.authorized);
        expect(r1[i]!.netCostEUR).toBe(r0[i]!.netCostEUR);
        expect(r1[i]!.latencyMs).toBe(r0[i]!.latencyMs);
      }
    }
    // Sanity: R0 and R1 should actually agree sometimes in the base world, or this test checks nothing.
    expect(agreementsChecked).toBeGreaterThan(0);
  });

  it("is deterministic across repeated calls", () => {
    const run = () =>
      evaluateRouters({
        scenario,
        seed: "evaluate-determinism",
        streamLength: 300,
        rangeStart: 100,
        rangeEnd: 199,
        conversionRates: rates,
        routers: { R0: naiveRouter, R1: r1Router },
      });
    expect(run()).toEqual(run());
  });
});
