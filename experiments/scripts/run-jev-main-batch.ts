/**
 * Main comparison (sections 9.2, 9.4): Jev (R3, with R1 fallback) vs R2 across all 6
 * scenarios, 20 eval seeds each, test slice only (section 9.2: ~84,000 calls before caching).
 * R2 uses the tuned params already committed from build step 2
 * (experiments/config/tuned/<scenario>.json) — not re-tuned here.
 *
 * Run with: node --env-file=.env ./node_modules/.bin/tsx experiments/scripts/run-jev-main-batch.ts [scenarioId ...]
 * With no arguments, runs all 6 scenarios in order.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import { getJevModel } from "../../lib/jev/config.js";
import { RuleParamsSchema } from "../../lib/routers/ruleRouter.js";
import { createRuleRouter } from "../../lib/routers/ruleRouter.js";
import { evaluateRouters, type DecisionRecord } from "../../lib/experiments/evaluate.js";
import { pairDecisions, summarizeJevVsR2 } from "../../lib/experiments/jevComparison.js";
import { runJevBatchForSeed, type JevDecisionRecord } from "../../lib/experiments/jevBatch.js";
import { EVAL_SEED_COUNT, STREAM_LENGTH, TEST_SLICE, evalSeed } from "../../lib/experiments/seeds.js";
import {
  CONFIG_DIR,
  PROJECT_ROOT,
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
} from "../../lib/simulation/configLoader.js";
import { resolveScenario, SCENARIO_IDS, type ScenarioId } from "../../lib/simulation/scenarios.js";

const CONCURRENCY = 15;
const DATA_RICHNESS_LEVEL = 2;

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }
  const model = getJevModel();

  const requestedScenarios = process.argv.slice(2) as ScenarioId[];
  const scenarioIds = requestedScenarios.length > 0 ? requestedScenarios : SCENARIO_IDS;
  for (const id of scenarioIds) {
    if (!SCENARIO_IDS.includes(id)) throw new Error(`Unknown scenario id "${id}"`);
  }

  const baseWorld = loadWorldConfig();
  const baseStream = loadStreamConfig();
  const baseObservedView = loadObservedViewBase();
  const rates = loadCurrencyConversion();

  for (const scenarioId of scenarioIds) {
    console.log(`\n=== Main comparison: scenario="${scenarioId}" ===`);
    const started = Date.now();

    const scenarioConfig = loadScenarioConfig(scenarioId);
    const resolved = resolveScenario(scenarioConfig, { world: baseWorld, stream: baseStream, observedView: baseObservedView });

    const tunedParamsRaw = JSON.parse(readFileSync(join(CONFIG_DIR, "tuned", `${scenarioId}.json`), "utf-8"));
    const tunedParams = RuleParamsSchema.parse(tunedParamsRaw);
    const r2Router = createRuleRouter(tunedParams);

    const jevBySeed = new Map<string, JevDecisionRecord[]>();
    const r2BySeed = new Map<string, DecisionRecord[]>();
    let singleEligibleCount = 0;
    let zeroEligibleCount = 0;

    for (let i = 1; i <= EVAL_SEED_COUNT; i++) {
      const seed = evalSeed(scenarioId, i);
      const cache = createInMemoryCache();

      const jevResult = await runJevBatchForSeed({
        scenario: resolved,
        seed,
        model,
        cache,
        dataRichnessLevel: DATA_RICHNESS_LEVEL,
        conversionRates: rates,
        apiKey,
        concurrency: CONCURRENCY,
      });

      const r2Result = evaluateRouters({
        scenario: resolved,
        seed,
        streamLength: STREAM_LENGTH,
        rangeStart: TEST_SLICE.start,
        rangeEnd: TEST_SLICE.end,
        conversionRates: rates,
        routers: { R2: r2Router },
      });

      jevBySeed.set(seed, jevResult.decisions);
      r2BySeed.set(seed, r2Result.decisionsByRouter.R2!);
      singleEligibleCount += jevResult.singleEligibleCount;
      zeroEligibleCount += jevResult.zeroEligibleCount;

      const okSoFar = jevResult.decisions.filter((d) => d.jevStatus === "ok").length;
      console.log(
        `  seed ${i}/${EVAL_SEED_COUNT} (${seed}): ${jevResult.decisions.length} decisions, ${okSoFar} ok, ` +
          `${jevResult.decisions.length - okSoFar} fallback (${(Date.now() - started) / 1000}s elapsed)`
      );
    }

    const paired = pairDecisions(jevBySeed, r2BySeed);
    const summary = summarizeJevVsR2(paired, 2000, `${scenarioId}|jev-vs-r2`);

    const elapsedSec = (Date.now() - started) / 1000;
    console.log(`\n--- ${scenarioId} summary (${elapsedSec.toFixed(1)}s) ---`);
    console.log(`decisions: ${summary.n}  single-eligible: ${singleEligibleCount}  zero-eligible: ${zeroEligibleCount}`);
    console.log(
      `Jev auth rate: ${(summary.jevAuthorizationRate.mean * 100).toFixed(2)}% [${(summary.jevAuthorizationRate.lo * 100).toFixed(2)}, ${(summary.jevAuthorizationRate.hi * 100).toFixed(2)}]`
    );
    console.log(
      `R2  auth rate: ${(summary.r2AuthorizationRate.mean * 100).toFixed(2)}% [${(summary.r2AuthorizationRate.lo * 100).toFixed(2)}, ${(summary.r2AuthorizationRate.hi * 100).toFixed(2)}]`
    );
    console.log(`Jev net cost/authorized: €${summary.jevNetCostPerAuthorized.mean.toFixed(4)}  R2: €${summary.r2NetCostPerAuthorized.mean.toFixed(4)}`);
    console.log(`Jev ok=${summary.jevOkCount} invalid=${summary.jevInvalidCount} failed=${summary.jevFailedCount} fallbackRate=${(summary.jevFallbackRate * 100).toFixed(2)}%`);
    console.log(`Jev avg call latency: ${summary.jevAverageCallLatencyMs.toFixed(0)}ms worst: ${summary.jevWorstCallLatencyMs.toFixed(0)}ms`);
    console.log(`Jev avg cost/live call: $${summary.jevAverageCostPerLiveCall.toFixed(6)} (${summary.jevLiveCallCount} live calls)`);
    console.log(`Disagreement rate: ${(summary.disagreementRate * 100).toFixed(2)}% (${summary.disagreementCount} of ${summary.n})`);
    console.log(`On disagreement: Jev wins ${summary.onDisagreement.jevWins}, R2 wins ${summary.onDisagreement.r2Wins}, ties ${summary.onDisagreement.ties}`);

    const outPath = join(PROJECT_ROOT, "experiments", "results", `jev-main-${scenarioId}.json`);
    writeFileSync(
      outPath,
      JSON.stringify(
        {
          scenarioId,
          tunedR2Params: tunedParams,
          singleEligibleCount,
          zeroEligibleCount,
          summary,
        },
        null,
        2
      )
    );
    console.log(`Wrote ${outPath}`);
  }
}

main();
