/**
 * Experiment 2 (v2) main comparison: Jev vs the rule routers on the high-volume world, across
 * all 6 scenarios, eval seeds 1-20, test slice — scored as pre-registered in
 * docs/hypotheses-v2.md (primary metric: expected authorization rate).
 *
 * Same as v1's run-jev-main-batch.ts except: observed stats come from the v2 high-volume
 * background history, R2 uses the v2-tuned params (experiments/config/v2/tuned/), and every
 * router is also scored by expected authorization (the true probability that its chosen PSP
 * authorizes), with paired bootstrap CIs on the differences. v1 Jev is replayed from the
 * recorded fixtures (free) on the same seeds, so "did more data help Jev" is a paired comparison.
 *
 *   --dry-run   Fake Jev, no network, no API key, fixtures written to a temp dir. Checks the
 *               whole pipeline and estimates the number of live calls and their cost.
 *
 * Run with: node --env-file=.env ./node_modules/.bin/tsx experiments/scripts/run-jev-v2-batch.ts [--dry-run] [scenarioId ...]
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eligiblePsps } from "../../lib/domain/eligibility.js";
import type { PspId } from "../../lib/domain/types.js";
import { worldAcceptanceRate } from "../../lib/domain/world.js";
import { evaluateRouters } from "../../lib/experiments/evaluate.js";
import { runJevBatchForSeed, type JevDecisionRecord } from "../../lib/experiments/jevBatch.js";
import { pairDecisions, summarizeJevVsR2 } from "../../lib/experiments/jevComparison.js";
import { bootstrapMeanCI, generateResampleIndices, type ConfidenceInterval } from "../../lib/experiments/metrics.js";
import { EVAL_SEED_COUNT, STREAM_LENGTH, TEST_SLICE, evalSeed } from "../../lib/experiments/seeds.js";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import type { callJevDecisions } from "../../lib/jev/client.js";
import { getJevModel } from "../../lib/jev/config.js";
import { naiveRouter } from "../../lib/routers/naive.js";
import { createRuleRouter, r1Router, RuleParamsSchema } from "../../lib/routers/ruleRouter.js";
import { statsReferenceRouter } from "../../lib/routers/statsReference.js";
import {
  CONFIG_DIR,
  PROJECT_ROOT,
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
} from "../../lib/simulation/configLoader.js";
import { resolveScenario, SCENARIO_IDS, type ResolvedScenario, type ScenarioId } from "../../lib/simulation/scenarios.js";
import { generateStream } from "../../lib/simulation/stream.js";

const CONCURRENCY = 15;
const DATA_RICHNESS_LEVEL = 2;
const BOOTSTRAP_ITERATIONS = 2000;

const COMPARATORS = ["R0", "R1", "R2", "statsReference", "jevV1"] as const;

/** Dry-run stand-in for Jev: answers with the first eligible option, and counts calls and request sizes. */
function fakeJev(stats: { calls: number; requestChars: number }): typeof callJevDecisions {
  return async (request) => {
    stats.calls++;
    stats.requestChars += JSON.stringify(request).length;
    const [questionId, question] = Object.entries(request.questions)[0]!;
    const options = Object.keys(question.criteria);
    return {
      model: request.model,
      answers: {
        [questionId]: {
          type: "choice",
          choice: options[0]!,
          probabilities: Object.fromEntries(options.map((o, i) => [o, i === 0 ? 1 : 0])),
          confidence: 1,
        },
      },
    };
  };
}

/** v1 replay never pays: anything missing from the recorded fixtures fails (and falls back to R1, counted). */
const noLiveCalls: typeof callJevDecisions = async () => {
  throw new Error("v1 replay is fixture-only; no live calls");
};

function fmt(ci: ConfidenceInterval): string {
  return `${(ci.mean * 100).toFixed(2)} [${(ci.lo * 100).toFixed(2)}, ${(ci.hi * 100).toFixed(2)}]`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const scenarioIds = (args.filter((a) => a !== "--dry-run") as ScenarioId[]).length
    ? (args.filter((a) => a !== "--dry-run") as ScenarioId[])
    : [...SCENARIO_IDS];
  for (const id of scenarioIds) if (!SCENARIO_IDS.includes(id)) throw new Error(`Unknown scenario id "${id}"`);

  const apiKey = dryRun ? "dry-run" : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }
  const model = getJevModel();
  const dryRunFixturesDir = dryRun ? mkdtempSync(join(tmpdir(), "jev-v2-dry-run-")) : undefined;
  const dryRunStats = { calls: 0, requestChars: 0 };
  const v1RequestStats = { calls: 0, requestChars: 0 };

  const rates = loadCurrencyConversion();
  const base = { world: loadWorldConfig(), stream: loadStreamConfig(), observedView: loadObservedViewBase() };
  const highVolume = JSON.parse(readFileSync(join(CONFIG_DIR, "v2", "high-volume.json"), "utf-8")) as { perTransaction: number };

  let v1CostSum = 0;
  let v1CostCount = 0;

  for (const scenarioId of scenarioIds) {
    console.log(`\n=== v2 ${dryRun ? "DRY RUN " : ""}scenario="${scenarioId}" ===`);
    const started = Date.now();
    const v1: ResolvedScenario = resolveScenario(loadScenarioConfig(scenarioId), base);
    const v2: ResolvedScenario = {
      ...v1,
      observedView: { ...v1.observedView, highVolumeHistory: { perTransaction: highVolume.perTransaction, stream: v1.stream, conversionRates: rates } },
    };
    const r2Params = RuleParamsSchema.parse(JSON.parse(readFileSync(join(CONFIG_DIR, "v2", "tuned", `${scenarioId}.json`), "utf-8")));
    const rules = { R0: naiveRouter, R1: r1Router, R2: createRuleRouter(r2Params), statsReference: statsReferenceRouter };

    const jevBySeed = new Map<string, JevDecisionRecord[]>();
    const r2BySeed = new Map<string, ReturnType<typeof evaluateRouters>["decisionsByRouter"][string]>();
    const expected: Record<string, number[]> = { jev: [], oracle: [], R0: [], R1: [], R2: [], statsReference: [], jevV1: [] };
    let jevV1Fallbacks = 0;

    for (let i = 1; i <= EVAL_SEED_COUNT; i++) {
      const seed = evalSeed(scenarioId, i);
      const jev = await runJevBatchForSeed({
        scenario: v2, seed, model, cache: createInMemoryCache(), dataRichnessLevel: DATA_RICHNESS_LEVEL,
        conversionRates: rates, apiKey, concurrency: CONCURRENCY, fixturesDir: dryRunFixturesDir,
        callClient: dryRun ? fakeJev(dryRunStats) : undefined,
      });
      const jevV1 = await runJevBatchForSeed({
        scenario: v1, seed, model, cache: createInMemoryCache(), dataRichnessLevel: DATA_RICHNESS_LEVEL,
        conversionRates: rates, apiKey: "replay-only", concurrency: CONCURRENCY, callClient: noLiveCalls,
      });
      const ruleRun = evaluateRouters({
        scenario: v2, seed, streamLength: STREAM_LENGTH, rangeStart: TEST_SLICE.start, rangeEnd: TEST_SLICE.end,
        conversionRates: rates, routers: rules,
      });
      if (dryRun && i === 1) {
        // Same transactions with v1 data, sent to the fake: the request-size baseline for the cost estimate.
        await runJevBatchForSeed({
          scenario: v1, seed, model, cache: createInMemoryCache(), dataRichnessLevel: DATA_RICHNESS_LEVEL, conversionRates: rates,
          apiKey, concurrency: CONCURRENCY, fixturesDir: join(dryRunFixturesDir!, "v1-size"), callClient: fakeJev(v1RequestStats),
        });
      }
      jevBySeed.set(seed, jev.decisions);
      r2BySeed.set(seed, ruleRun.decisionsByRouter.R2!);
      for (const d of jevV1.decisions) {
        if (d.usedFallback) jevV1Fallbacks++;
        if (d.jevCost !== undefined) { v1CostSum += d.jevCost; v1CostCount++; }
      }

      // Expected authorization: true probability the chosen PSP authorizes, per decision, aligned by transaction index.
      const stream = generateStream(seed, STREAM_LENGTH, v2.stream, rates);
      const choiceAt = (records: { transactionIndex: number; chosenPspId: PspId }[]) => new Map(records.map((d) => [d.transactionIndex, d.chosenPspId]));
      const picks = {
        jev: choiceAt(jev.decisions),
        jevV1: choiceAt(jevV1.decisions),
        ...Object.fromEntries(Object.keys(rules).map((k) => [k, choiceAt(ruleRun.decisionsByRouter[k]!)])),
      } as Record<string, Map<number, PspId>>;
      for (const d of jev.decisions) {
        const t = d.transactionIndex;
        const tx = stream[t]!;
        const eligible = eligiblePsps(v2.world.psps, tx);
        const truth = (id: PspId) => eligible.find((p) => p.id === id)!.availabilityRate * worldAcceptanceRate(v2.world, id, tx, t);
        expected.oracle!.push(Math.max(...eligible.map((p) => truth(p.id))));
        for (const [k, m] of Object.entries(picks)) expected[k]!.push(truth(m.get(t)!));
      }

      const ok = jev.decisions.filter((d) => d.jevStatus === "ok").length;
      console.log(`  seed ${i}/${EVAL_SEED_COUNT}: ${jev.decisions.length} decisions, ${ok} ok, ${jev.decisions.length - ok} fallback (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }

    const n = expected.jev!.length;
    const resample = generateResampleIndices(n, BOOTSTRAP_ITERATIONS, `v2|${scenarioId}|expected`);
    const expectedAuth = Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, bootstrapMeanCI(v, resample)]));
    const jevMinus = Object.fromEntries(
      COMPARATORS.map((k) => [k, bootstrapMeanCI(expected.jev!.map((v, i) => v - expected[k]![i]!), resample)])
    );
    const r0 = expectedAuth.R0!.mean;
    const headroomCaptured = (expectedAuth.jev!.mean - r0) / (expectedAuth.oracle!.mean - r0);
    const realized = summarizeJevVsR2(pairDecisions(jevBySeed, r2BySeed), BOOTSTRAP_ITERATIONS, `v2|${scenarioId}|jev-vs-r2`);

    console.log(`--- ${scenarioId}: ${n} decisions (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    console.log(`  expected auth: ${Object.entries(expectedAuth).map(([k, ci]) => `${k} ${fmt(ci)}`).join(" | ")}`);
    console.log(`  Jev minus:     ${Object.entries(jevMinus).map(([k, ci]) => `${k} ${fmt(ci)}pp`).join(" | ")}`);
    console.log(`  headroom captured by Jev: ${(headroomCaptured * 100).toFixed(0)}%  | v1 replay fallbacks: ${jevV1Fallbacks}`);
    console.log(`  realized auth: Jev ${fmt(realized.jevAuthorizationRate)} R2 ${fmt(realized.r2AuthorizationRate)} | Jev ok=${realized.jevOkCount} invalid=${realized.jevInvalidCount} failed=${realized.jevFailedCount}`);

    if (!dryRun) {
      const outPath = join(PROJECT_ROOT, "experiments", "results", `jev-v2-${scenarioId}.json`);
      writeFileSync(outPath, JSON.stringify({ scenarioId, highVolume, tunedR2Params: r2Params, expectedAuth, jevMinus, headroomCaptured, jevV1Fallbacks, realized }, null, 2));
      console.log(`Wrote ${outPath}`);
    }
  }

  if (dryRun) {
    const v1AvgCost = v1CostCount > 0 ? v1CostSum / v1CostCount : NaN;
    console.log(`\n=== DRY RUN SUMMARY ===`);
    console.log(`live calls a real run would make: ${dryRunStats.calls}`);
    console.log(`average request size: ${(dryRunStats.requestChars / Math.max(1, dryRunStats.calls)).toFixed(0)} chars (v1, same transactions: ${(v1RequestStats.requestChars / Math.max(1, v1RequestStats.calls)).toFixed(0)} chars)`);
    console.log(`v1 average recorded cost per call: $${v1AvgCost.toFixed(7)} (over ${v1CostCount} replayed v1 decisions)`);
    console.log(`estimated cost at the v1 rate: $${(dryRunStats.calls * v1AvgCost).toFixed(2)} (compare request sizes with v1 before trusting this)`);
    rmSync(dryRunFixturesDir!, { recursive: true, force: true });
  }
}

main();
