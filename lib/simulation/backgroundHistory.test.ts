import { describe, expect, it } from "vitest";
import { checkEligibility } from "../domain/eligibility.js";
import { worldAcceptanceRate } from "../domain/world.js";
import { loadCurrencyConversion, loadScenarioConfig, loadStreamConfig, loadWorldConfig } from "./configLoader.js";
import { computeObservedView, type ObservedViewConfig } from "./observedView.js";
import { resolveScenario } from "./scenarios.js";
import { generateStream, generateTransaction } from "./stream.js";

const baseWorld = loadWorldConfig();
const baseStream = loadStreamConfig();
const rates = loadCurrencyConversion();
const PER_TX = 20;

function highVolumeCfg(stream = baseStream): ObservedViewConfig {
  return {
    lag: 50,
    window: 150,
    backgroundHistoryLimits: [],
    highVolumeHistory: { perTransaction: PER_TX, stream, conversionRates: rates },
  };
}

describe("computeObservedView with v2 high-volume background history", () => {
  const seed = "high-volume-test";
  const stream = generateStream(seed, 1000, baseStream, rates);
  const alpha = baseWorld.psps.find((p) => p.id === "alpha")!;

  it("still has no observed data before the lag has elapsed", () => {
    const view = computeObservedView(stream, 10, stream[10]!, alpha, baseWorld, seed, highVolumeCfg());
    expect(view.acceptanceOverall).toEqual({ value: null, sampleSize: 0 });
  });

  it("uses exactly the eligible background transactions mapped into [t - lag - window, t - lag]", () => {
    const t = 300;
    const view = computeObservedView(stream, t, stream[t]!, alpha, baseWorld, seed, highVolumeCfg());
    let expected = 0;
    for (let j = (t - 50 - 150) * PER_TX; j < (t - 50 + 1) * PER_TX; j++) {
      if (checkEligibility(alpha, generateTransaction(`${seed}|background`, j, baseStream, rates)).eligible) expected++;
    }
    expect(view.acceptanceOverall.sampleSize).toBe(expected);
    // ~perTransaction times the v1 window, so far less sampling noise.
    expect(expected).toBeGreaterThan(150 * PER_TX * 0.8);
  });

  it("is deterministic, including across separately built configs", () => {
    const a = computeObservedView(stream, 500, stream[500]!, alpha, baseWorld, seed, highVolumeCfg());
    const b = computeObservedView(stream, 500, stream[500]!, alpha, baseWorld, seed, highVolumeCfg());
    expect(a).toEqual(b);
  });

  it("lands close to the true acceptance rate", () => {
    const view = computeObservedView(stream, 500, stream[500]!, alpha, baseWorld, seed, highVolumeCfg());
    expect(Math.abs(view.acceptanceOverall.value! - alpha.baseAcceptanceRate)).toBeLessThan(0.015);
  });

  it("applies drift by main-stream time, so it shows up only after the lag", () => {
    const drift = resolveScenario(loadScenarioConfig("drift"), { world: baseWorld, stream: baseStream, observedView: { lag: 50, window: 150 } });
    const beta = drift.world.psps.find((p) => p.id === "beta")!;
    const cfg = highVolumeCfg(drift.stream);
    const before = computeObservedView(stream, 640, stream[640]!, beta, drift.world, seed, cfg); // window ends at 590, pre-drift
    const after = computeObservedView(stream, 999, stream[999]!, beta, drift.world, seed, cfg); // window 799-949, all post-drift
    expect(worldAcceptanceRate(drift.world, "beta", stream[999]!, 999)).toBeLessThan(worldAcceptanceRate(drift.world, "beta", stream[999]!, 0));
    expect(before.acceptanceOverall.value! - after.acceptanceOverall.value!).toBeGreaterThan(0.06);
  });
});
