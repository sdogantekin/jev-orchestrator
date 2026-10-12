import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "./evaluate.js";
import { compareOutcomes, pairDecisions, summarizeJevVsR2 } from "./jevComparison.js";
import type { JevDecisionRecord } from "./jevBatch.js";

function jev(overrides: Partial<JevDecisionRecord> = {}): JevDecisionRecord {
  return {
    transactionIndex: 0,
    jevStatus: "ok",
    usedFallback: false,
    chosenPspId: "alpha",
    authorized: true,
    netCostEUR: 1,
    latencyMs: 300,
    jevConfidence: 0.8,
    jevProbabilities: { alpha: 0.8, beta: 0.2 },
    jevCallLatencyMs: 300,
    jevCost: 0.00006,
    jevSource: "live",
    ...overrides,
  };
}

function r2(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return { transactionIndex: 0, chosenPspId: "alpha", authorized: true, netCostEUR: 1, latencyMs: 300, ...overrides };
}

describe("compareOutcomes", () => {
  it("authorized beats not authorized, regardless of cost", () => {
    expect(compareOutcomes({ authorized: true, netCostEUR: 100 }, { authorized: false, netCostEUR: 0 })).toBe("jev_wins");
    expect(compareOutcomes({ authorized: false, netCostEUR: 0 }, { authorized: true, netCostEUR: 100 })).toBe("r2_wins");
  });

  it("when both authorized (or both not), lower net cost wins", () => {
    expect(compareOutcomes({ authorized: true, netCostEUR: 1 }, { authorized: true, netCostEUR: 2 })).toBe("jev_wins");
    expect(compareOutcomes({ authorized: true, netCostEUR: 2 }, { authorized: true, netCostEUR: 1 })).toBe("r2_wins");
  });

  it("equal authorization and equal cost is a tie", () => {
    expect(compareOutcomes({ authorized: true, netCostEUR: 1 }, { authorized: true, netCostEUR: 1 })).toBe("tie");
    expect(compareOutcomes({ authorized: false, netCostEUR: 0 }, { authorized: false, netCostEUR: 0 })).toBe("tie");
  });
});

describe("pairDecisions", () => {
  it("pairs by (seed, transactionIndex)", () => {
    const jevBySeed = new Map([["seed1", [jev({ transactionIndex: 1 }), jev({ transactionIndex: 2 })]]]);
    const r2BySeed = new Map([["seed1", [r2({ transactionIndex: 2 }), r2({ transactionIndex: 1 })]]]); // deliberately out of order
    const paired = pairDecisions(jevBySeed, r2BySeed);
    expect(paired.length).toBe(2);
    expect(paired.find((p) => p.transactionIndex === 1)!.r2.transactionIndex).toBe(1);
    expect(paired.find((p) => p.transactionIndex === 2)!.r2.transactionIndex).toBe(2);
  });

  it("throws if a seed is missing from the R2 side", () => {
    const jevBySeed = new Map([["seed1", [jev()]]]);
    const r2BySeed = new Map<string, DecisionRecord[]>();
    expect(() => pairDecisions(jevBySeed, r2BySeed)).toThrow();
  });

  it("throws if a transaction index is missing on the R2 side (eligibility diverged)", () => {
    const jevBySeed = new Map([["seed1", [jev({ transactionIndex: 5 })]]]);
    const r2BySeed = new Map([["seed1", [r2({ transactionIndex: 6 })]]]);
    expect(() => pairDecisions(jevBySeed, r2BySeed)).toThrow();
  });
});

describe("summarizeJevVsR2", () => {
  it("computes a hand-checkable disagreement rate and wins/losses/ties", () => {
    const paired = [
      // agreement: same PSP, not a disagreement regardless of outcome
      { seed: "s1", transactionIndex: 1, jev: jev({ transactionIndex: 1, chosenPspId: "alpha" }), r2: r2({ transactionIndex: 1, chosenPspId: "alpha" }) },
      // disagreement, jev authorized, r2 not -> jev wins
      {
        seed: "s1",
        transactionIndex: 2,
        jev: jev({ transactionIndex: 2, chosenPspId: "beta", authorized: true }),
        r2: r2({ transactionIndex: 2, chosenPspId: "alpha", authorized: false }),
      },
      // disagreement, both authorized, jev cheaper -> jev wins
      {
        seed: "s1",
        transactionIndex: 3,
        jev: jev({ transactionIndex: 3, chosenPspId: "beta", authorized: true, netCostEUR: 1 }),
        r2: r2({ transactionIndex: 3, chosenPspId: "alpha", authorized: true, netCostEUR: 2 }),
      },
      // disagreement, both authorized, equal cost -> tie
      {
        seed: "s1",
        transactionIndex: 4,
        jev: jev({ transactionIndex: 4, chosenPspId: "beta", authorized: true, netCostEUR: 1 }),
        r2: r2({ transactionIndex: 4, chosenPspId: "alpha", authorized: true, netCostEUR: 1 }),
      },
      // disagreement, r2 authorized, jev not -> r2 wins
      {
        seed: "s1",
        transactionIndex: 5,
        jev: jev({ transactionIndex: 5, chosenPspId: "beta", authorized: false }),
        r2: r2({ transactionIndex: 5, chosenPspId: "gamma", authorized: true }),
      },
    ];

    const summary = summarizeJevVsR2(paired, 500, "test-seed");
    expect(summary.n).toBe(5);
    expect(summary.disagreementCount).toBe(4);
    expect(summary.disagreementRate).toBe(0.8);
    expect(summary.onDisagreement).toEqual({ jevWins: 2, r2Wins: 1, ties: 1 });
  });

  it("computes authorization rate means directly (bootstrap CI brackets the true mean)", () => {
    const paired = Array.from({ length: 20 }, (_, i) => ({
      seed: "s1",
      transactionIndex: i,
      jev: jev({ transactionIndex: i, authorized: i < 15 }), // 15/20 = 0.75
      r2: r2({ transactionIndex: i, authorized: i < 10 }), // 10/20 = 0.5
    }));
    const summary = summarizeJevVsR2(paired, 1000, "test-seed-2");
    expect(summary.jevAuthorizationRate.mean).toBeCloseTo(0.75, 10);
    expect(summary.r2AuthorizationRate.mean).toBeCloseTo(0.5, 10);
  });

  it("counts status and fallback rates correctly", () => {
    const paired = [
      { seed: "s1", transactionIndex: 1, jev: jev({ transactionIndex: 1, jevStatus: "ok", usedFallback: false }), r2: r2({ transactionIndex: 1 }) },
      { seed: "s1", transactionIndex: 2, jev: jev({ transactionIndex: 2, jevStatus: "invalid", usedFallback: true }), r2: r2({ transactionIndex: 2 }) },
      { seed: "s1", transactionIndex: 3, jev: jev({ transactionIndex: 3, jevStatus: "failed", usedFallback: true }), r2: r2({ transactionIndex: 3 }) },
      { seed: "s1", transactionIndex: 4, jev: jev({ transactionIndex: 4, jevStatus: "ok", usedFallback: false }), r2: r2({ transactionIndex: 4 }) },
    ];
    const summary = summarizeJevVsR2(paired, 100, "test-seed-3");
    expect(summary.jevOkCount).toBe(2);
    expect(summary.jevInvalidCount).toBe(1);
    expect(summary.jevFailedCount).toBe(1);
    expect(summary.jevFallbackRate).toBe(0.5);
  });
});
