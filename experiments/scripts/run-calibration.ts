/**
 * Calibration probe (section 9.3): "when Jev says 70% for a PSP, how often is that PSP the
 * better one in the simulation?" Derived entirely from the main comparison's already-recorded
 * fixtures (section 9.2's 6 scenarios x 20 seeds x test slice) rather than separate live calls:
 * every Jev response already contains a full probability distribution over every eligible PSP,
 * and the simulated outcome for any eligible PSP (not just the one actually chosen) is cheap,
 * pure computation. No network access, no API key needed.
 *
 * "The better one" is read as a comparative, not absolute, claim: among this transaction's
 * eligible PSPs, is this specific one the ground-truth best (section 9.1's outcome rule, applied
 * pairwise across every eligible PSP, not just the two a pair of routers happened to choose)?
 * A first pass compared each PSP's stated probability against its own absolute simulated
 * authorization instead, and came back essentially flat (~92-94% at every probability level) -
 * not a real finding, just an artifact of this world's PSPs all having broadly similar, high
 * base acceptance rates, so "authorized" barely discriminates between them regardless of which
 * one Jev favored. Comparing against the actual best alternative is the discriminating version
 * of the question the probe is supposed to answer.
 *
 * Run with: npx tsx experiments/scripts/run-calibration.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { eligiblePsps } from "../../lib/domain/eligibility.js";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import { decideWithJev } from "../../lib/jev/decide.js";
import { getJevModel } from "../../lib/jev/config.js";
import { compareOutcomes } from "../../lib/experiments/jevComparison.js";
import { computeObservedView, type ObservedPspStats } from "../../lib/simulation/observedView.js";
import { simulatePspOutcome, type PspOutcome } from "../../lib/simulation/outcome.js";
import { generateStream } from "../../lib/simulation/stream.js";
import { resolveScenario, SCENARIO_IDS } from "../../lib/simulation/scenarios.js";
import {
  PROJECT_ROOT,
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
} from "../../lib/simulation/configLoader.js";
import type { PspId } from "../../lib/domain/types.js";
import { EVAL_SEED_COUNT, STREAM_LENGTH, TEST_SLICE, evalSeed } from "../../lib/experiments/seeds.js";

/** The ground-truth best PSP among several simulated outcomes, per section 9.1's pairwise rule. Ties keep the earlier one (order given by `eligible`, so this is deterministic). */
function actualBestPspId(eligible: PspId[], outcomes: Record<PspId, PspOutcome>): PspId {
  let best = eligible[0]!;
  for (const candidate of eligible.slice(1)) {
    if (compareOutcomes(outcomes[candidate]!, outcomes[best]!) === "jev_wins") best = candidate;
  }
  return best;
}

const BUCKET_COUNT = 10;
const DATA_RICHNESS_LEVEL = 2;
const model = getJevModel();

async function main() {
  const baseWorld = loadWorldConfig();
  const baseStream = loadStreamConfig();
  const baseObservedView = loadObservedViewBase();
  const rates = loadCurrencyConversion();

  const buckets = Array.from({ length: BUCKET_COUNT }, () => ({ probabilitySum: 0, actualBestCount: 0, count: 0 }));
  let samplesUsed = 0;
  let decisionsSkippedNotOk = 0;

  for (const scenarioId of SCENARIO_IDS) {
    const resolved = resolveScenario(loadScenarioConfig(scenarioId), { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    console.log(`scenario=${scenarioId}`);

    for (let i = 1; i <= EVAL_SEED_COUNT; i++) {
      const seed = evalSeed(scenarioId, i);
      const stream = generateStream(seed, STREAM_LENGTH, resolved.stream, rates);
      const cache = createInMemoryCache();

      for (let t = TEST_SLICE.start; t <= TEST_SLICE.end; t++) {
        const tx = stream[t]!;
        const eligible = eligiblePsps(resolved.world.psps, tx);
        if (eligible.length < 2) continue;

        const observed: Partial<Record<PspId, ObservedPspStats>> = {};
        for (const psp of eligible) {
          observed[psp.id] = computeObservedView(stream, t, tx, psp, resolved.world, seed, resolved.observedView);
        }

        const result = await decideWithJev({
          tx,
          eligible,
          observed,
          dataRichnessLevel: DATA_RICHNESS_LEVEL,
          model,
          cache,
          allowLive: false, // fixture-only: this must never make a network call
        });

        if (result.status !== "ok") {
          decisionsSkippedNotOk++;
          continue;
        }

        const outcomesByPsp = {} as Record<PspId, PspOutcome>;
        for (const psp of eligible) outcomesByPsp[psp.id] = simulatePspOutcome(seed, t, tx, psp, resolved.world);
        const bestId = actualBestPspId(eligible.map((p) => p.id), outcomesByPsp);

        for (const psp of eligible) {
          const probability = result.probabilities[psp.id];
          if (probability === undefined) continue;
          const bucketIndex = Math.min(BUCKET_COUNT - 1, Math.floor(probability * BUCKET_COUNT));
          const bucket = buckets[bucketIndex]!;
          bucket.probabilitySum += probability;
          bucket.actualBestCount += psp.id === bestId ? 1 : 0;
          bucket.count++;
          samplesUsed++;
        }
      }
    }
  }

  const curve = buckets.map((b, i) => ({
    bucketRange: [i / BUCKET_COUNT, (i + 1) / BUCKET_COUNT] as [number, number],
    meanStatedProbability: b.count > 0 ? b.probabilitySum / b.count : null,
    empiricalBestRate: b.count > 0 ? b.actualBestCount / b.count : null,
    sampleSize: b.count,
  }));

  console.log(`\nCalibration curve (${samplesUsed} (PSP, probability) samples, ${decisionsSkippedNotOk} decisions skipped as not-ok):\n`);
  for (const row of curve) {
    console.log(
      `[${row.bucketRange[0].toFixed(1)}, ${row.bucketRange[1].toFixed(1)}): stated=${row.meanStatedProbability?.toFixed(3) ?? "n/a"} actual=${row.empiricalBestRate?.toFixed(3) ?? "n/a"} n=${row.sampleSize}`
    );
  }

  const outPath = join(PROJECT_ROOT, "experiments", "results", "calibration.json");
  writeFileSync(outPath, JSON.stringify({ curve, samplesUsed, decisionsSkippedNotOk }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main();
