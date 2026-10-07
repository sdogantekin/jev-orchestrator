import { describe, expect, it } from "vitest";
import { checkEligibility } from "../domain/eligibility.js";
import { segmentKeyEquals, segmentKeyOf } from "../domain/types.js";
import { loadCurrencyConversion, loadScenarioConfig, loadStreamConfig, loadWorldConfig } from "./configLoader.js";
import { computeObservedView, type ObservedViewConfig } from "./observedView.js";
import { resolveScenario } from "./scenarios.js";
import { generateStream } from "./stream.js";

const baseWorld = loadWorldConfig();
const baseStream = loadStreamConfig();
const rates = loadCurrencyConversion();
const baseObservedView = { lag: 50, window: 150 };

describe("computeObservedView: lag and window", () => {
  const cfg: ObservedViewConfig = { ...baseObservedView, backgroundHistoryLimits: [] };
  const seed = "observed-lag-window";
  const stream = generateStream(seed, 1000, baseStream, rates);
  const alpha = baseWorld.psps.find((p) => p.id === "alpha")!;

  it("has no observed data before the lag has elapsed", () => {
    const tx = stream[10]!;
    const view = computeObservedView(stream, 10, tx, alpha, baseWorld, seed, cfg);
    expect(view.acceptanceOverall).toEqual({ value: null, sampleSize: 0 });
  });

  it("uses exactly the eligible attempts within [t - lag - window, t - lag]", () => {
    const t = 300;
    const tx = stream[t]!;
    const view = computeObservedView(stream, t, tx, alpha, baseWorld, seed, cfg);

    const lo = Math.max(0, t - cfg.lag - cfg.window);
    const hi = t - cfg.lag;
    const expectedEligible = stream
      .slice(lo, hi + 1)
      .filter((historicalTx) => checkEligibility(alpha, historicalTx).eligible);

    expect(view.acceptanceOverall.sampleSize).toBe(expectedEligible.length);

    const expectedSegmentCount = expectedEligible.filter((historicalTx) =>
      segmentKeyEquals(segmentKeyOf(historicalTx), segmentKeyOf(tx))
    ).length;
    expect(view.acceptanceSegment.sampleSize).toBe(expectedSegmentCount);
  });

  it("segment sample size never exceeds the overall sample size", () => {
    for (const t of [100, 400, 700, 999]) {
      const tx = stream[t]!;
      const view = computeObservedView(stream, t, tx, alpha, baseWorld, seed, cfg);
      expect(view.acceptanceSegment.sampleSize).toBeLessThanOrEqual(view.acceptanceOverall.sampleSize);
    }
  });

  it("is deterministic for the same inputs", () => {
    const t = 500;
    const tx = stream[t]!;
    const a = computeObservedView(stream, t, tx, alpha, baseWorld, seed, cfg);
    const b = computeObservedView(stream, t, tx, alpha, baseWorld, seed, cfg);
    expect(a).toEqual(b);
  });
});

describe("computeObservedView: thin data scenario caps a specific PSP+segment", () => {
  it("never reports more than 25 attempts for Beta's EUR/DE/card segment", () => {
    const scenarioConfig = loadScenarioConfig("thin_data");
    const resolved = resolveScenario(scenarioConfig, { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    const seed = "thin-data-check";
    const stream = generateStream(seed, 1000, resolved.stream, rates);
    const beta = resolved.world.psps.find((p) => p.id === "beta")!;

    for (const t of [200, 400, 600, 800, 999]) {
      const tx = stream[t]!;
      const view = computeObservedView(stream, t, tx, beta, resolved.world, seed, resolved.observedView);
      expect(view.acceptanceSegment.sampleSize).toBeLessThanOrEqual(25);
    }

    // Sanity: without the cap and looking at the PSP's full history (a wide window), this
    // segment accumulates well over 25 eligible attempts (DE+EUR+card is roughly 20% of
    // traffic, so ~200 eligible attempts by transaction 999).
    const uncapped = computeObservedView(
      stream,
      999,
      { ...stream[999]!, currency: "EUR", country: "DE", paymentMethod: "card" },
      beta,
      resolved.world,
      seed,
      { lag: 50, window: 2000, backgroundHistoryLimits: [] }
    );
    expect(uncapped.acceptanceSegment.sampleSize).toBeGreaterThan(25);
  });
});

describe("computeObservedView: cold start scenario caps a PSP's whole lifetime history", () => {
  it("never reports more than 20 attempts for Gamma, overall, at any point in the stream", () => {
    const scenarioConfig = loadScenarioConfig("cold_start");
    const resolved = resolveScenario(scenarioConfig, { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    const seed = "cold-start-check";
    const stream = generateStream(seed, 1000, resolved.stream, rates);
    const gamma = resolved.world.psps.find((p) => p.id === "gamma")!;

    for (const t of [100, 300, 600, 999]) {
      const tx = stream[t]!;
      const view = computeObservedView(stream, t, tx, gamma, resolved.world, seed, resolved.observedView);
      expect(view.acceptanceOverall.sampleSize).toBeLessThanOrEqual(20);
    }
  });

  it("leaves Gamma's true (world) acceptance rate at the base value", () => {
    const scenarioConfig = loadScenarioConfig("cold_start");
    const resolved = resolveScenario(scenarioConfig, { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    const gamma = resolved.world.psps.find((p) => p.id === "gamma")!;
    const baseGamma = baseWorld.psps.find((p) => p.id === "gamma")!;
    expect(gamma.baseAcceptanceRate).toBe(baseGamma.baseAcceptanceRate);
  });
});
