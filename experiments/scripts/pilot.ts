/**
 * Checkpoint C4 pilot (sections 9.7, 19.2): one scenario, one seed, live Jev calls, to check
 * cost, latency and correctness before asking for approval to run the full batch. Every
 * response is cached by state hash and recorded as a fixture, so repeated states within this
 * run only cost once and the whole run can be replayed for free afterward.
 *
 * Run with: node --env-file=.env ./node_modules/.bin/tsx experiments/scripts/pilot.ts
 */
import { eligiblePsps } from "../../lib/domain/eligibility.js";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import { getJevModel } from "../../lib/jev/config.js";
import { decideWithJev, type JevDecisionResult } from "../../lib/jev/decide.js";
import {
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
} from "../../lib/simulation/configLoader.js";
import { computeObservedView, type ObservedPspStats } from "../../lib/simulation/observedView.js";
import { resolveScenario } from "../../lib/simulation/scenarios.js";
import { generateStream } from "../../lib/simulation/stream.js";
import { evalSeed, STREAM_LENGTH, TEST_SLICE } from "../../lib/experiments/seeds.js";

const PILOT_SCENARIO_ID = "stable";
const PILOT_SEED_INDEX = 1;
const DATA_RICHNESS_LEVEL = 2;

// Call volumes from section 9.2, before caching.
const FULL_BATCH_CALL_ESTIMATE = {
  mainComparison: 84_000,
  dataRichness: 56_000,
  sensitivity: 35_000,
  probes: 5_000,
};

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set (see .env.example).");
    process.exit(1);
  }
  const model = getJevModel();

  const baseWorld = loadWorldConfig();
  const baseStream = loadStreamConfig();
  const baseObservedView = loadObservedViewBase();
  const rates = loadCurrencyConversion();

  const scenarioConfig = loadScenarioConfig(PILOT_SCENARIO_ID);
  const resolved = resolveScenario(scenarioConfig, { world: baseWorld, stream: baseStream, observedView: baseObservedView });

  const seed = evalSeed(PILOT_SCENARIO_ID, PILOT_SEED_INDEX);
  const stream = generateStream(seed, STREAM_LENGTH, resolved.stream, rates);
  const cache = createInMemoryCache();

  let decisionsAttempted = 0;
  let liveCalls = 0;
  let okCount = 0;
  let invalidCount = 0;
  let failedCount = 0;
  let totalCost = 0;
  let totalInputTokens = 0;
  const latenciesMs: number[] = [];
  let sample: { request: unknown; rawResponse: unknown } | null = null;
  const failures: Array<{ t: number; reason: string }> = [];

  const started = Date.now();

  for (let t = TEST_SLICE.start; t <= TEST_SLICE.end; t++) {
    const tx = stream[t]!;
    const eligible = eligiblePsps(resolved.world.psps, tx);
    if (eligible.length < 2) continue; // section 7: single/zero-eligible, no Jev decision

    const observed: Partial<Record<string, ObservedPspStats>> = {};
    for (const psp of eligible) {
      observed[psp.id] = computeObservedView(stream, t, tx, psp, resolved.world, seed, resolved.observedView);
    }

    decisionsAttempted++;
    const callStarted = Date.now();
    const result: JevDecisionResult = await decideWithJev({
      tx,
      eligible,
      observed,
      dataRichnessLevel: DATA_RICHNESS_LEVEL,
      model,
      cache,
      allowLive: true,
      apiKey,
    });
    const elapsedMs = Date.now() - callStarted;

    if (result.status === "ok") {
      okCount++;
      if (result.source === "live") {
        liveCalls++;
        latenciesMs.push(elapsedMs);
        totalCost += result.usage?.cost ?? 0;
        totalInputTokens += result.usage?.input_tokens ?? 0;
        if (!sample) sample = { request: result.request, rawResponse: result.rawResponse };
      }
    } else if (result.status === "invalid") {
      invalidCount++;
    } else {
      failedCount++;
      failures.push({ t, reason: result.reason });
    }

    if (decisionsAttempted % 100 === 0) {
      console.log(`... ${decisionsAttempted} decisions attempted, ${liveCalls} live calls so far`);
    }
  }

  const wallTimeSec = (Date.now() - started) / 1000;
  const avgLatency = latenciesMs.length > 0 ? latenciesMs.reduce((s, v) => s + v, 0) / latenciesMs.length : NaN;
  const worstLatency = latenciesMs.length > 0 ? Math.max(...latenciesMs) : NaN;
  const avgCostPerCall = liveCalls > 0 ? totalCost / liveCalls : NaN;
  const avgInputTokens = liveCalls > 0 ? totalInputTokens / liveCalls : NaN;

  console.log(`\n=== Pilot results: scenario="${PILOT_SCENARIO_ID}" seed="${seed}" data richness level ${DATA_RICHNESS_LEVEL} ===\n`);
  console.log(`decisions attempted (test slice, >=2 eligible): ${decisionsAttempted}`);
  console.log(`live calls made (after within-run cache dedup): ${liveCalls}`);
  console.log(`cache hit rate within this run: ${(((decisionsAttempted - liveCalls) / decisionsAttempted) * 100).toFixed(1)}%`);
  console.log(`ok: ${okCount}  invalid: ${invalidCount}  failed: ${failedCount}`);
  console.log(`total cost: $${totalCost.toFixed(6)}  avg cost/call: $${avgCostPerCall.toFixed(6)}`);
  console.log(`avg input tokens/call: ${avgInputTokens.toFixed(0)}`);
  console.log(`avg latency: ${avgLatency.toFixed(0)}ms  worst latency: ${worstLatency.toFixed(0)}ms`);
  console.log(`wall time: ${wallTimeSec.toFixed(1)}s (sequential, no parallelism yet)`);

  if (failures.length > 0) {
    console.log(`\nFailures (first 5):`);
    for (const f of failures.slice(0, 5)) console.log(`  t=${f.t}: ${f.reason}`);
  }

  console.log(`\nSample request/response:\n${JSON.stringify(sample, null, 2)}`);

  const totalCallsBeforeCaching = Object.values(FULL_BATCH_CALL_ESTIMATE).reduce((s, v) => s + v, 0);
  console.log(`\n=== Full-batch estimate, scaled from this pilot's observed per-call cost/latency ===`);
  console.log(`Assumed call volume before caching (section 9.2): ${totalCallsBeforeCaching.toLocaleString()}`);
  console.log(`Estimated cost if every call were unique (no caching): $${(totalCallsBeforeCaching * avgCostPerCall).toFixed(2)}`);
  console.log(`This pilot's within-run cache hit rate suggests real cost will be considerably lower; the real figure needs the full batch's actual duplicate-state rate, not this pilot's.`);
  console.log(`Estimated wall time at this pilot's sequential rate: ${((totalCallsBeforeCaching * avgLatency) / 1000 / 60).toFixed(0)} minutes — this is why the full batch runner needs parallel requests (section 19.3), not sequential like this pilot.`);
}

main();
