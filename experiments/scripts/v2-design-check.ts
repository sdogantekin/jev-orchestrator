/**
 * v2 design check — rules only, no Jev calls, free to run.
 *
 * v2 changes exactly one thing from v1: observed stats come from a platform that sees
 * `perTransaction` background transactions per main-stream transaction
 * (experiments/config/v2/high-volume.json), instead of the main stream alone. Same scenarios,
 * same world, same main streams and seeds, so any difference is down to data volume.
 *
 * Before any Jev call, v2 has to pass these criteria (fixed here, before looking at Jev):
 *   C1  Data quality: mean |observed overall acceptance - true acceptance| <= 0.75pp.
 *       Correction after the first run (2026-10-24): this was mis-specified. The overall rate
 *       is a blend across all transaction types, so it differs from one transaction's true rate
 *       even with infinite data (v2 overall error stayed ~1.6pp while the segment error fell
 *       from ~7.6pp to ~2pp). Both errors are reported; neither changes the v2 setup.
 *   C2  Data is useful: at least one simple data-following router beats R0 (always Alpha).
 *   C3  Headroom: oracle - R1 is reported; if it stays ~0.5pp, a fair test also needs a world
 *       change, decided separately.
 *
 * "Expected auth" = the true probability that the chosen PSP authorizes (availability x world
 * acceptance), averaged over decisions — the same comparison without coin-flip noise.
 *
 * Run with: npx tsx experiments/scripts/v2-design-check.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eligiblePsps } from "../../lib/domain/eligibility.js";
import { feeEUR } from "../../lib/domain/fees.js";
import type { PspConfig } from "../../lib/domain/psp.js";
import type { PspId } from "../../lib/domain/types.js";
import { worldAcceptanceRate } from "../../lib/domain/world.js";
import { evalSeed, TEST_SLICE, STREAM_LENGTH, EVAL_SEED_COUNT } from "../../lib/experiments/seeds.js";
import { naiveRouter } from "../../lib/routers/naive.js";
import { createRuleRouter, r1Router } from "../../lib/routers/ruleRouter.js";
import { loadTunedRuleParams } from "../../lib/routers/loadTunedParams.js";
import { tuneR2 } from "../../lib/routers/tuning.js";
import type { RouterFn } from "../../lib/routers/types.js";
import {
  CONFIG_DIR,
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
  PROJECT_ROOT,
} from "../../lib/simulation/configLoader.js";
import { computeObservedView, type ObservedPspStats } from "../../lib/simulation/observedView.js";
import { resolveScenario, SCENARIO_IDS, type ResolvedScenario } from "../../lib/simulation/scenarios.js";
import { generateStream } from "../../lib/simulation/stream.js";

const rates = loadCurrencyConversion();
const base = { world: loadWorldConfig(), stream: loadStreamConfig(), observedView: loadObservedViewBase() };
const highVolume = JSON.parse(readFileSync(join(CONFIG_DIR, "v2", "high-volume.json"), "utf-8")) as { perTransaction: number };
const TUNED_DIR = join(CONFIG_DIR, "v2", "tuned");
const RESULTS_DIR = join(PROJECT_ROOT, "experiments", "results");
mkdirSync(TUNED_DIR, { recursive: true });
mkdirSync(RESULTS_DIR, { recursive: true });

type Observed = Partial<Record<PspId, ObservedPspStats>>;

function argmax(eligible: PspConfig[], score: (p: PspConfig) => number): PspId {
  return eligible.reduce((best, p) => (score(p) > score(best) ? p : best)).id;
}

/** Check-only control: the PSP with the highest observed overall acceptance. */
const followOverall: RouterFn = ({ eligible, observed }) =>
  argmax(eligible, (p) => observed[p.id]?.acceptanceOverall.value ?? -1);

/** Check-only control: the PSP with the highest observed segment acceptance (overall if the segment is empty). */
const followSegment: RouterFn = ({ eligible, observed }) =>
  argmax(eligible, (p) => observed[p.id]?.acceptanceSegment.value ?? observed[p.id]?.acceptanceOverall.value ?? -1);

/**
 * Check-only reference for "simple statistics done right": blend segment and overall
 * acceptance by how much segment data there is (a segment with K attempts counts half), then
 * pick the highest. Not a router in the experiment (yet) — it only answers "can a
 * data-following router win here at all?".
 */
const SHRINK_K = 100;
const followShrunk: RouterFn = ({ tx, eligible, observed }) =>
  argmax(eligible, (p) => {
    const o = observed[p.id];
    const overall = o?.acceptanceOverall.value ?? -1;
    const seg = o?.acceptanceSegment;
    const blended = seg?.value != null ? (seg.value * seg.sampleSize + overall * SHRINK_K) / (seg.sampleSize + SHRINK_K) : overall;
    return blended - feeEUR(p, tx.amountEUR) * 1e-9; // fee only breaks exact ties
  });

function withHighVolume(resolved: ResolvedScenario): ResolvedScenario {
  return {
    ...resolved,
    observedView: {
      ...resolved.observedView,
      highVolumeHistory: { perTransaction: highVolume.perTransaction, stream: resolved.stream, conversionRates: rates },
    },
  };
}

interface VariantResult {
  decisions: number;
  observedErrorOverallPp: number;
  observedErrorSegmentPp: number;
  medianSegmentSampleSize: number;
  expectedAuth: Record<string, number>;
}

function evaluate(scenarioId: string, sc: ResolvedScenario, r2: RouterFn): VariantResult {
  const routers: Record<string, RouterFn> = { R0: naiveRouter, R1: r1Router, R2: r2, followOverall, followSegment, followShrunk };
  const sum: Record<string, number> = {};
  const add = (k: string, v: number) => (sum[k] = (sum[k] ?? 0) + v);
  let n = 0;
  let errO = 0, errON = 0, errS = 0, errSN = 0;
  const segSizes: number[] = [];

  for (let s = 0; s < EVAL_SEED_COUNT; s++) {
    const seed = evalSeed(scenarioId, s);
    const stream = generateStream(seed, STREAM_LENGTH, sc.stream, rates);
    for (let t = TEST_SLICE.start; t <= TEST_SLICE.end; t++) {
      const tx = stream[t]!;
      const eligible = eligiblePsps(sc.world.psps, tx);
      if (eligible.length < 2) continue;
      n++;
      const observed: Observed = {};
      for (const p of eligible) observed[p.id] = computeObservedView(stream, t, tx, p, sc.world, seed, sc.observedView);

      const truth = (id: PspId) => eligible.find((p) => p.id === id)!.availabilityRate * worldAcceptanceRate(sc.world, id, tx, t);
      for (const p of eligible) {
        const trueAcc = worldAcceptanceRate(sc.world, p.id, tx, t);
        const o = observed[p.id]!;
        if (o.acceptanceOverall.value != null) { errO += Math.abs(o.acceptanceOverall.value - trueAcc); errON++; }
        if (o.acceptanceSegment.value != null) { errS += Math.abs(o.acceptanceSegment.value - trueAcc); errSN++; }
        segSizes.push(o.acceptanceSegment.sampleSize);
      }
      const values = eligible.map((p) => truth(p.id));
      add("worst", Math.min(...values));
      add("oracle", Math.max(...values));
      for (const [k, fn] of Object.entries(routers)) add(k, truth(fn({ tx, eligible, observed })));
    }
  }
  segSizes.sort((a, b) => a - b);
  const expectedAuth: Record<string, number> = {};
  for (const [k, v] of Object.entries(sum)) expectedAuth[k] = v / n;
  return {
    decisions: n,
    observedErrorOverallPp: (errO / errON) * 100,
    observedErrorSegmentPp: (errS / errSN) * 100,
    medianSegmentSampleSize: segSizes[Math.floor(segSizes.length / 2)]!,
    expectedAuth,
  };
}

const pct = (x: number) => (x * 100).toFixed(2);
const out: Record<string, { v1: VariantResult; v2: VariantResult; v2TunedR2Params: unknown }> = {};

for (const scenarioId of SCENARIO_IDS) {
  const started = Date.now();
  const v1 = resolveScenario(loadScenarioConfig(scenarioId), base);
  const v2 = withHighVolume(v1);

  const v2Params = tuneR2(v2, scenarioId, rates);
  writeFileSync(join(TUNED_DIR, `${scenarioId}.json`), JSON.stringify(v2Params, null, 2));

  const resV1 = evaluate(scenarioId, v1, createRuleRouter(loadTunedRuleParams(scenarioId)));
  const resV2 = evaluate(scenarioId, v2, createRuleRouter(v2Params));
  out[scenarioId] = { v1: resV1, v2: resV2, v2TunedR2Params: v2Params };

  console.log(`\n=== ${scenarioId} (${((Date.now() - started) / 1000).toFixed(0)}s) — ${resV1.decisions} decisions, 20 seeds, test slice`);
  console.log(`              data error overall  segment  median segment n`);
  for (const [label, r] of [["v1", resV1], ["v2", resV2]] as const) {
    console.log(`  ${label}          ${r.observedErrorOverallPp.toFixed(2)}pp           ${r.observedErrorSegmentPp.toFixed(2)}pp   ${r.medianSegmentSampleSize}`);
  }
  const cols = ["worst", "R0", "R1", "R2", "followOverall", "followSegment", "followShrunk", "oracle"];
  console.log(`  expected auth  ${cols.join("  ")}`);
  for (const [label, r] of [["v1", resV1], ["v2", resV2]] as const) {
    console.log(`  ${label}            ${cols.map((c) => pct(r.expectedAuth[c]!)).join("  ")}`);
  }
  console.log(`  v2 tuned R2: ${JSON.stringify(v2Params)}`);
}

writeFileSync(join(RESULTS_DIR, "v2-design-check.json"), JSON.stringify({ highVolume, scenarios: out }, null, 2));
