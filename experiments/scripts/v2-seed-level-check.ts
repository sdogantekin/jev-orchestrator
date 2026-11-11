/**
 * Experiment 2 robustness check, added after the run (2026-11-11). No live calls: replays the
 * recorded Jev answers and fails loudly if any is missing.
 *
 * The pre-registered CIs (docs/hypotheses-v2.md) bootstrap over individual decisions. Decisions
 * within one seed share the same observed data, so they aren't independent and those CIs are
 * optimistic. This recomputes every Jev difference with the 20 seeds as the unit: one mean
 * difference per seed, then a 95% t-interval over the 20 values (df = 19).
 *
 * Run with: npx tsx experiments/scripts/v2-seed-level-check.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eligiblePsps } from "../../lib/domain/eligibility.js";
import type { PspId } from "../../lib/domain/types.js";
import { worldAcceptanceRate } from "../../lib/domain/world.js";
import { evaluateRouters } from "../../lib/experiments/evaluate.js";
import { runJevBatchForSeed } from "../../lib/experiments/jevBatch.js";
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
import { resolveScenario, SCENARIO_IDS, type ResolvedScenario } from "../../lib/simulation/scenarios.js";
import { generateStream } from "../../lib/simulation/stream.js";

const T_95_DF19 = 2.093;
const COMPARATORS = ["jevV1", "R0", "R1", "R2", "statsReference"] as const;

const noLiveCalls: typeof callJevDecisions = async () => {
  throw new Error("replay only; no live calls");
};

function interval(values: number[]) {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  const half = (T_95_DF19 * sd) / Math.sqrt(n);
  return { mean, lo: mean - half, hi: mean + half, seedsPositive: values.filter((v) => v > 0).length, seeds: n };
}

async function main() {
  const rates = loadCurrencyConversion();
  const base = { world: loadWorldConfig(), stream: loadStreamConfig(), observedView: loadObservedViewBase() };
  const highVolume = JSON.parse(readFileSync(join(CONFIG_DIR, "v2", "high-volume.json"), "utf-8")) as { perTransaction: number };
  const out: Record<string, unknown> = {};

  for (const scenarioId of SCENARIO_IDS) {
    const v1: ResolvedScenario = resolveScenario(loadScenarioConfig(scenarioId), base);
    const v2: ResolvedScenario = {
      ...v1,
      observedView: { ...v1.observedView, highVolumeHistory: { perTransaction: highVolume.perTransaction, stream: v1.stream, conversionRates: rates } },
    };
    const r2 = createRuleRouter(RuleParamsSchema.parse(JSON.parse(readFileSync(join(CONFIG_DIR, "v2", "tuned", `${scenarioId}.json`), "utf-8"))));
    const perSeed: Record<string, number[]> = Object.fromEntries(COMPARATORS.map((k) => [k, []]));

    for (let i = 1; i <= EVAL_SEED_COUNT; i++) {
      const seed = evalSeed(scenarioId, i);
      const replay = (scenario: ResolvedScenario) =>
        runJevBatchForSeed({ scenario, seed, model: getJevModel(), cache: createInMemoryCache(), dataRichnessLevel: 2, conversionRates: rates, apiKey: "replay-only", callClient: noLiveCalls });
      const jev = await replay(v2);
      const jevV1 = await replay(v1);
      if ([...jev.decisions, ...jevV1.decisions].some((d) => d.usedFallback)) throw new Error(`Missing recorded Jev answer: ${scenarioId} seed ${i}`);
      const rules = evaluateRouters({
        scenario: v2, seed, streamLength: STREAM_LENGTH, rangeStart: TEST_SLICE.start, rangeEnd: TEST_SLICE.end, conversionRates: rates,
        routers: { R0: naiveRouter, R1: r1Router, R2: r2, statsReference: statsReferenceRouter },
      });

      const stream = generateStream(seed, STREAM_LENGTH, v2.stream, rates);
      const expected = (records: { transactionIndex: number; chosenPspId: PspId }[]) =>
        records.reduce((sum, d) => {
          const tx = stream[d.transactionIndex]!;
          const psp = eligiblePsps(v2.world.psps, tx).find((p) => p.id === d.chosenPspId)!;
          return sum + psp.availabilityRate * worldAcceptanceRate(v2.world, psp.id, tx, d.transactionIndex);
        }, 0) / records.length;

      const jevMean = expected(jev.decisions);
      perSeed.jevV1!.push(jevMean - expected(jevV1.decisions));
      for (const k of ["R0", "R1", "R2", "statsReference"] as const) perSeed[k]!.push(jevMean - expected(rules.decisionsByRouter[k]!));
    }

    const result = Object.fromEntries(COMPARATORS.map((k) => [k, interval(perSeed[k]!)]));
    out[scenarioId] = { jevMinus: result };
    console.log(scenarioId + ": " + COMPARATORS.map((k) => {
      const r = result[k]!;
      return `Jev-${k} ${(r.mean * 100).toFixed(2)} [${(r.lo * 100).toFixed(2)}, ${(r.hi * 100).toFixed(2)}] (${r.seedsPositive}/${r.seeds})`;
    }).join(" | "));
  }

  writeFileSync(join(PROJECT_ROOT, "experiments", "results", "v2-seed-level.json"), JSON.stringify(out, null, 2));
}

main();
