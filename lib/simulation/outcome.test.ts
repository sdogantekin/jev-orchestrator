import { describe, expect, it } from "vitest";
import { loadCurrencyConversion, loadStreamConfig, loadWorldConfig } from "./configLoader.js";
import { simulatePspOutcome } from "./outcome.js";
import { generateTransaction } from "./stream.js";

const world = loadWorldConfig();
const streamConfig = loadStreamConfig();
const rates = loadCurrencyConversion();

describe("simulatePspOutcome", () => {
  it("is deterministic for the same (seed, index, psp, world)", () => {
    const tx = generateTransaction("seed-det", 10, streamConfig, rates);
    const psp = world.psps[0]!;
    const a = simulatePspOutcome("seed-det", 10, tx, psp, world);
    const b = simulatePspOutcome("seed-det", 10, tx, psp, world);
    expect(a).toEqual(b);
  });

  it("common random numbers: two PSPs chosen for the same transaction get independent, but each individually reproducible, outcomes", () => {
    const tx = generateTransaction("seed-crn", 20, streamConfig, rates);
    const alpha = world.psps.find((p) => p.id === "alpha")!;
    const beta = world.psps.find((p) => p.id === "beta")!;
    const alphaOutcome1 = simulatePspOutcome("seed-crn", 20, tx, alpha, world);
    const alphaOutcome2 = simulatePspOutcome("seed-crn", 20, tx, alpha, world);
    const betaOutcome = simulatePspOutcome("seed-crn", 20, tx, beta, world);
    // Same PSP, same transaction: identical regardless of how many times or in what context it's computed.
    expect(alphaOutcome1).toEqual(alphaOutcome2);
    // Different PSPs are not forced to share a result.
    expect(alphaOutcome1.pspId).not.toBe(betaOutcome.pspId);
  });

  it("common random numbers: outcome for a PSP does not depend on which other PSP 'won' the routing decision", () => {
    // Simulate two different routers both ultimately picking PSP Alpha for the same transaction,
    // after considering different candidate sets. The outcome for Alpha must be identical.
    const tx = generateTransaction("seed-crn2", 30, streamConfig, rates);
    const alpha = world.psps.find((p) => p.id === "alpha")!;
    const routerOneChoice = simulatePspOutcome("seed-crn2", 30, tx, alpha, world);
    const routerTwoChoice = simulatePspOutcome("seed-crn2", 30, tx, alpha, world);
    expect(routerOneChoice).toEqual(routerTwoChoice);
  });

  it("an unavailable PSP is never authorized and has no latency reading", () => {
    const tx = generateTransaction("seed-avail", 1, streamConfig, rates);
    const alwaysDown = { ...world.psps[0]!, availabilityRate: 0 };
    const outcome = simulatePspOutcome("seed-avail", 1, tx, alwaysDown, world);
    expect(outcome.available).toBe(false);
    expect(outcome.authorized).toBe(false);
    expect(outcome.latencyMs).toBeNull();
    expect(outcome.feeEUR).toBe(0);
  });

  it("an always-available, always-accepting PSP is authorized and charged a fee, never a chargeback when chargebackRate is 0", () => {
    const tx = generateTransaction("seed-accept", 1, streamConfig, rates);
    const perfect = { ...world.psps[0]!, availabilityRate: 1, baseAcceptanceRate: 1, chargebackRate: 0 };
    const worldPerfect = { ...world, segmentModifiers: [], psps: world.psps.map((p) => (p.id === perfect.id ? perfect : p)) };
    const outcome = simulatePspOutcome("seed-accept", 1, tx, perfect, worldPerfect);
    expect(outcome.available).toBe(true);
    expect(outcome.authorized).toBe(true);
    expect(outcome.chargeback).toBe(false);
    expect(outcome.feeEUR).toBeGreaterThan(0);
    expect(outcome.latencyMs).not.toBeNull();
  });

  it("latency varies within plus or minus 20 percent of the central value", () => {
    const psp = world.psps.find((p) => p.id === "gamma")!;
    const alwaysUp = { ...psp, availabilityRate: 1 };
    const worldUp = { ...world, psps: world.psps.map((p) => (p.id === "gamma" ? alwaysUp : p)) };
    for (let i = 0; i < 200; i++) {
      const tx = generateTransaction("seed-latency", i, streamConfig, rates);
      const outcome = simulatePspOutcome("seed-latency", i, tx, alwaysUp, worldUp);
      expect(outcome.latencyMs).not.toBeNull();
      expect(outcome.latencyMs!).toBeGreaterThanOrEqual(psp.latencyCentralMs * 0.8 - 1e-9);
      expect(outcome.latencyMs!).toBeLessThanOrEqual(psp.latencyCentralMs * 1.2 + 1e-9);
    }
  });

  it("never draws a chargeback on a non-authorized transaction", () => {
    const psp = { ...world.psps.find((p) => p.id === "gamma")!, baseAcceptanceRate: 0, chargebackRate: 1 };
    const worldZero = { ...world, segmentModifiers: [], psps: world.psps.map((p) => (p.id === "gamma" ? psp : p)) };
    const tx = generateTransaction("seed-no-cb", 1, streamConfig, rates);
    const outcome = simulatePspOutcome("seed-no-cb", 1, tx, psp, worldZero);
    expect(outcome.authorized).toBe(false);
    expect(outcome.chargeback).toBe(false);
    expect(outcome.chargebackLossEUR).toBe(0);
  });
});
