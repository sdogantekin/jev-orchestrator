/**
 * Sensitivity check (section 9.6): repeat the main comparison with perturbed world design,
 * Stable scenario only, 5 seeds (distinct from both the 20 eval seeds and the tuning seeds).
 * Reports whether the main comparison's conclusion (R2 beats Jev's authorization rate on
 * Stable) holds up under each small change, as a robustness check with fewer seeds than the
 * main results (reported separately, never mixed into the main tables).
 *
 * Run with: node --env-file=.env ./node_modules/.bin/tsx experiments/scripts/run-sensitivity.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import { getJevModel } from "../../lib/jev/config.js";
import { createRuleRouter, RuleParamsSchema } from "../../lib/routers/ruleRouter.js";
import { evaluateRouters, type DecisionRecord } from "../../lib/experiments/evaluate.js";
import { pairDecisions, summarizeJevVsR2 } from "../../lib/experiments/jevComparison.js";
import { runJevBatchForSeed, type JevDecisionRecord } from "../../lib/experiments/jevBatch.js";
import { SENSITIVITY_SEED_COUNT, STREAM_LENGTH, TEST_SLICE, sensitivitySeed } from "../../lib/experiments/seeds.js";
import {
  CONFIG_DIR,
  PROJECT_ROOT,
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
} from "../../lib/simulation/configLoader.js";
import { resolveScenario, type ResolvedScenario } from "../../lib/simulation/scenarios.js";

const SCENARIO_ID = "stable";
const CONCURRENCY = 15;
const DATA_RICHNESS_LEVEL = 2;

const VARIANTS = [
  "segment_half",
  "segment_double",
  "drift_0.04",
  "drift_0.12",
  "lag_25",
  "lag_100",
  "window_75",
  "window_300",
  "chargeback_fee_25",
] as const;
type Variant = (typeof VARIANTS)[number];

function applyVariant(base: ResolvedScenario, variant: Variant): { scenario: ResolvedScenario; chargebackFixedFeeEUR?: number } {
  switch (variant) {
    case "segment_half":
      return { scenario: { ...base, world: { ...base.world, segmentModifiers: base.world.segmentModifiers.map((m) => ({ ...m, delta: m.delta * 0.5 })) } } };
    case "segment_double":
      return { scenario: { ...base, world: { ...base.world, segmentModifiers: base.world.segmentModifiers.map((m) => ({ ...m, delta: m.delta * 2 })) } } };
    case "drift_0.04":
      return { scenario: { ...base, world: { ...base.world, drift: { startIndex: 600, pspId: "beta", acceptanceDelta: -0.04 } } } };
    case "drift_0.12":
      return { scenario: { ...base, world: { ...base.world, drift: { startIndex: 600, pspId: "beta", acceptanceDelta: -0.12 } } } };
    case "lag_25":
      return { scenario: { ...base, observedView: { ...base.observedView, lag: 25 } } };
    case "lag_100":
      return { scenario: { ...base, observedView: { ...base.observedView, lag: 100 } } };
    case "window_75":
      return { scenario: { ...base, observedView: { ...base.observedView, window: 75 } } };
    case "window_300":
      return { scenario: { ...base, observedView: { ...base.observedView, window: 300 } } };
    case "chargeback_fee_25":
      return { scenario: base, chargebackFixedFeeEUR: 25 };
  }
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }
  const model = getJevModel();

  const baseWorld = loadWorldConfig();
  const baseStream = loadStreamConfig();
  const baseObservedView = loadObservedViewBase();
  const rates = loadCurrencyConversion();
  const baseResolved = resolveScenario(loadScenarioConfig(SCENARIO_ID), { world: baseWorld, stream: baseStream, observedView: baseObservedView });

  const tunedParams = RuleParamsSchema.parse(JSON.parse(readFileSync(join(CONFIG_DIR, "tuned", `${SCENARIO_ID}.json`), "utf-8")));
  const r2Router = createRuleRouter(tunedParams);

  const baselineMainResult = JSON.parse(readFileSync(join(PROJECT_ROOT, "experiments", "results", `jev-main-${SCENARIO_ID}.json`), "utf-8"));
  const baselineJevAuth = baselineMainResult.summary.jevAuthorizationRate.mean;
  const baselineR2Auth = baselineMainResult.summary.r2AuthorizationRate.mean;
  console.log(`Baseline (main comparison, 20 seeds): Jev auth=${(baselineJevAuth * 100).toFixed(2)}% R2 auth=${(baselineR2Auth * 100).toFixed(2)}% gap=${((baselineR2Auth - baselineJevAuth) * 100).toFixed(2)}pp`);

  const results: Record<string, unknown> = { baseline: { jevAuth: baselineJevAuth, r2Auth: baselineR2Auth } };

  for (const variant of VARIANTS) {
    console.log(`\n=== Sensitivity variant: ${variant} ===`);
    const started = Date.now();
    const { scenario, chargebackFixedFeeEUR } = applyVariant(baseResolved, variant);

    const jevBySeed = new Map<string, JevDecisionRecord[]>();
    const r2BySeed = new Map<string, DecisionRecord[]>();

    for (let i = 1; i <= SENSITIVITY_SEED_COUNT; i++) {
      const seed = sensitivitySeed(SCENARIO_ID, variant, i);
      const jevResult = await runJevBatchForSeed({
        scenario,
        seed,
        model,
        cache: createInMemoryCache(),
        dataRichnessLevel: DATA_RICHNESS_LEVEL,
        conversionRates: rates,
        apiKey,
        concurrency: CONCURRENCY,
        chargebackFixedFeeEUR,
      });
      const r2Result = evaluateRouters({
        scenario,
        seed,
        streamLength: STREAM_LENGTH,
        rangeStart: TEST_SLICE.start,
        rangeEnd: TEST_SLICE.end,
        conversionRates: rates,
        routers: { R2: r2Router },
        chargebackFixedFeeEUR,
      });
      jevBySeed.set(seed, jevResult.decisions);
      r2BySeed.set(seed, r2Result.decisionsByRouter.R2!);
      console.log(`  seed ${i}/${SENSITIVITY_SEED_COUNT}: ${jevResult.decisions.length} decisions (${((Date.now() - started) / 1000).toFixed(1)}s elapsed)`);
    }

    const paired = pairDecisions(jevBySeed, r2BySeed);
    const summary = summarizeJevVsR2(paired, 2000, `${SCENARIO_ID}|sensitivity|${variant}`);
    const gapPp = (summary.r2AuthorizationRate.mean - summary.jevAuthorizationRate.mean) * 100;
    const baselineGapPp = (baselineR2Auth - baselineJevAuth) * 100;
    const flipped = Math.sign(gapPp) !== Math.sign(baselineGapPp) && Math.abs(gapPp) > 0.01;

    console.log(
      `${variant}: Jev=${(summary.jevAuthorizationRate.mean * 100).toFixed(2)}% R2=${(summary.r2AuthorizationRate.mean * 100).toFixed(2)}% gap=${gapPp.toFixed(2)}pp ` +
        `(baseline gap ${baselineGapPp.toFixed(2)}pp) ${flipped ? "** CONCLUSION FLIPPED **" : ""}`
    );

    results[variant] = { n: summary.n, jevAuth: summary.jevAuthorizationRate, r2Auth: summary.r2AuthorizationRate, gapPp, baselineGapPp, flipped, disagreementRate: summary.disagreementRate };
  }

  const outPath = join(PROJECT_ROOT, "experiments", "results", "sensitivity.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main();
