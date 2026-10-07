import { describe, expect, it } from "vitest";
import { loadScenarioConfig, loadStreamConfig, loadWorldConfig } from "./configLoader.js";
import { resolveScenario, SCENARIO_IDS } from "./scenarios.js";

const baseWorld = loadWorldConfig();
const baseStream = loadStreamConfig();
const baseObservedView = { lag: 50, window: 150 };

describe("scenario configs", () => {
  it.each(SCENARIO_IDS)("loads and validates %s.json", (id) => {
    const config = loadScenarioConfig(id);
    expect(config.id).toBe(id);
  });
});

describe("resolveScenario", () => {
  it("stable: resolves to the base world and stream unchanged, no drift, no limits", () => {
    const resolved = resolveScenario(loadScenarioConfig("stable"), { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    expect(resolved.world).toEqual(baseWorld);
    expect(resolved.stream).toEqual(baseStream);
    expect(resolved.observedView.backgroundHistoryLimits).toEqual([]);
  });

  it("drift: sets the drift config and leaves PSP base rates untouched", () => {
    const resolved = resolveScenario(loadScenarioConfig("drift"), { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    expect(resolved.world.drift).toEqual({ startIndex: 600, pspId: "beta", acceptanceDelta: -0.08 });
    expect(resolved.world.psps).toEqual(baseWorld.psps);
  });

  it("conflicting_objectives: overrides all three PSPs' acceptance/cost/fee and skews amount buckets", () => {
    const resolved = resolveScenario(loadScenarioConfig("conflicting_objectives"), {
      world: baseWorld,
      stream: baseStream,
      observedView: baseObservedView,
    });
    const alpha = resolved.world.psps.find((p) => p.id === "alpha")!;
    expect(alpha.baseAcceptanceRate).toBeCloseTo(0.955, 10);
    expect(alpha.transactionCostPercent).toBeCloseTo(2.0, 10);
    expect(resolved.stream.amount.bucketWeights).toEqual({ small: 0.4, medium: 0.3, large: 0.3 });
    // Unrelated stream settings (e.g. device mix) are untouched by this scenario.
    expect(resolved.stream.device).toEqual(baseStream.device);
  });

  it("eligibility_mix: overrides only the payment method weights", () => {
    const resolved = resolveScenario(loadScenarioConfig("eligibility_mix"), {
      world: baseWorld,
      stream: baseStream,
      observedView: baseObservedView,
    });
    expect(resolved.stream.paymentMethod).toEqual({ card: 0.6, paypal: 0.267, sepa_debit: 0.133 });
    expect(resolved.world).toEqual(baseWorld);
  });

  it("thin_data and cold_start: carry background history limits through to the resolved observed-view config", () => {
    const thin = resolveScenario(loadScenarioConfig("thin_data"), { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    expect(thin.observedView.backgroundHistoryLimits).toEqual([
      { pspId: "beta", segmentKey: { currency: "EUR", country: "DE", paymentMethod: "card" }, maxAttempts: 25 },
    ]);

    const cold = resolveScenario(loadScenarioConfig("cold_start"), { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    expect(cold.observedView.backgroundHistoryLimits).toEqual([{ pspId: "gamma", maxAttempts: 20 }]);
  });
});
