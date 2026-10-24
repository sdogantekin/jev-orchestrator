/**
 * Post-hoc diagnosis of Experiment 1 (EXPERIMENT.md Section 10). No live calls: it replays
 * Jev's recorded v1 answers from experiments/fixtures/ and fails loudly if any is missing.
 *
 * Scores every router by expected authorization (the true probability that its chosen PSP
 * authorizes), next to two "follow the data" controls and the oracle, and measures how often
 * Jev picks the PSP with the highest observed acceptance.
 *
 * Run with: npx tsx experiments/scripts/v1-diagnosis.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { eligiblePsps } from "../../lib/domain/eligibility.js";
import type { PspConfig } from "../../lib/domain/psp.js";
import type { PspId } from "../../lib/domain/types.js";
import { worldAcceptanceRate } from "../../lib/domain/world.js";
import { EVAL_SEED_COUNT, STREAM_LENGTH, TEST_SLICE, evalSeed } from "../../lib/experiments/seeds.js";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import { getJevModel } from "../../lib/jev/config.js";
import { decideWithJev } from "../../lib/jev/decide.js";
import { loadTunedRuleParams } from "../../lib/routers/loadTunedParams.js";
import { naiveRouter } from "../../lib/routers/naive.js";
import { createRuleRouter, r1Router } from "../../lib/routers/ruleRouter.js";
import {
  PROJECT_ROOT,
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
} from "../../lib/simulation/configLoader.js";
import { computeObservedView, type ObservedPspStats } from "../../lib/simulation/observedView.js";
import { resolveScenario, SCENARIO_IDS } from "../../lib/simulation/scenarios.js";
import { generateStream } from "../../lib/simulation/stream.js";

const rates = loadCurrencyConversion();
const base = { world: loadWorldConfig(), stream: loadStreamConfig(), observedView: loadObservedViewBase() };
const model = getJevModel();

function argmax(eligible: PspConfig[], score: (p: PspConfig) => number): PspId {
  return eligible.reduce((best, p) => (score(p) > score(best) ? p : best)).id;
}

async function main() {
  const out: Record<string, unknown> = {};
  for (const scenarioId of SCENARIO_IDS) {
    const sc = resolveScenario(loadScenarioConfig(scenarioId), base);
    const r2 = createRuleRouter(loadTunedRuleParams(scenarioId));
    const sum: Record<string, number> = {};
    const add = (k: string, v: number) => (sum[k] = (sum[k] ?? 0) + v);
    let n = 0;

    for (let i = 1; i <= EVAL_SEED_COUNT; i++) {
      const seed = evalSeed(scenarioId, i);
      const stream = generateStream(seed, STREAM_LENGTH, sc.stream, rates);
      for (let t = TEST_SLICE.start; t <= TEST_SLICE.end; t++) {
        const tx = stream[t]!;
        const eligible = eligiblePsps(sc.world.psps, tx);
        if (eligible.length < 2) continue;
        const observed: Partial<Record<PspId, ObservedPspStats>> = {};
        for (const p of eligible) observed[p.id] = computeObservedView(stream, t, tx, p, sc.world, seed, sc.observedView);

        const jev = await decideWithJev({ tx, eligible, observed, dataRichnessLevel: 2, model, cache: createInMemoryCache(), allowLive: false });
        if (jev.status !== "ok") throw new Error(`Missing or invalid recorded Jev answer: ${scenarioId} seed ${i} t=${t} (${jev.status})`);
        n++;

        const truth = (id: PspId) => eligible.find((p) => p.id === id)!.availabilityRate * worldAcceptanceRate(sc.world, id, tx, t);
        const followOverall = argmax(eligible, (p) => observed[p.id]!.acceptanceOverall.value ?? -1);
        const followSegment = argmax(eligible, (p) => observed[p.id]!.acceptanceSegment.value ?? observed[p.id]!.acceptanceOverall.value ?? -1);
        const picks: Record<string, PspId> = {
          R0: naiveRouter({ tx, eligible, observed }),
          R1: r1Router({ tx, eligible, observed }),
          R2: r2({ tx, eligible, observed }),
          followOverall,
          followSegment,
          jev: jev.choice,
        };
        add("oracle", Math.max(...eligible.map((p) => truth(p.id))));
        for (const [k, c] of Object.entries(picks)) add(k, truth(c));
        add("jevPicksHighestObservedOverall", jev.choice === followOverall ? 1 : 0);
        add("jevPicksHighestObservedSegment", jev.choice === followSegment ? 1 : 0);
      }
    }

    const result = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / n]));
    out[scenarioId] = { decisions: n, ...result };
    const pct = (k: string) => (result[k]! * 100).toFixed(2);
    console.log(
      `${scenarioId}: oracle ${pct("oracle")} R1 ${pct("R1")} R0 ${pct("R0")} R2 ${pct("R2")} | followSegment ${pct("followSegment")} followOverall ${pct("followOverall")} | Jev ${pct("jev")} | Jev = highest observed overall ${pct("jevPicksHighestObservedOverall")}%`
    );
  }
  writeFileSync(join(PROJECT_ROOT, "experiments", "results", "v1-diagnosis.json"), JSON.stringify(out, null, 2));
}

main();
