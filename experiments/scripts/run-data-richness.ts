/**
 * Data richness comparison (section 9.5): levels 1, 2 and 3 on Stable and Drift, same 20 seeds.
 * Level 2 is re-requested here too, but since it's the same (scenario, seed, model) as the main
 * comparison already ran, every one of those hits a committed fixture for free - only levels 1
 * and 3 cost anything new (section 9.2: 56,000 calls).
 *
 * Run with: node --env-file=.env ./node_modules/.bin/tsx experiments/scripts/run-data-richness.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import { getJevModel } from "../../lib/jev/config.js";
import type { DataRichnessLevel } from "../../lib/jev/state.js";
import { runJevBatchForSeed, type JevDecisionRecord } from "../../lib/experiments/jevBatch.js";
import { bootstrapMeanCI, bootstrapMeanCIStandalone, generateResampleIndices } from "../../lib/experiments/metrics.js";
import { EVAL_SEED_COUNT, evalSeed } from "../../lib/experiments/seeds.js";
import { PROJECT_ROOT, loadCurrencyConversion, loadObservedViewBase, loadScenarioConfig, loadStreamConfig, loadWorldConfig } from "../../lib/simulation/configLoader.js";
import { resolveScenario } from "../../lib/simulation/scenarios.js";

const SCENARIOS = ["stable", "drift"] as const;
const LEVELS: DataRichnessLevel[] = [1, 2, 3];
const CONCURRENCY = 15;

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

  for (const scenarioId of SCENARIOS) {
    console.log(`\n=== Data richness: scenario="${scenarioId}" ===`);
    const started = Date.now();
    const resolved = resolveScenario(loadScenarioConfig(scenarioId), { world: baseWorld, stream: baseStream, observedView: baseObservedView });

    // decisionsByLevel[level] is keyed by `${seed}|${transactionIndex}` for cross-level lookup.
    const decisionsByLevel = new Map<DataRichnessLevel, Map<string, JevDecisionRecord>>();

    for (const level of LEVELS) {
      const byKey = new Map<string, JevDecisionRecord>();
      for (let i = 1; i <= EVAL_SEED_COUNT; i++) {
        const seed = evalSeed(scenarioId, i);
        const { decisions } = await runJevBatchForSeed({
          scenario: resolved,
          seed,
          model,
          cache: createInMemoryCache(),
          dataRichnessLevel: level,
          conversionRates: rates,
          apiKey,
          concurrency: CONCURRENCY,
        });
        for (const d of decisions) byKey.set(`${seed}|${d.transactionIndex}`, d);
      }
      decisionsByLevel.set(level, byKey);
      console.log(`  level ${level}: ${byKey.size} decisions (${((Date.now() - started) / 1000).toFixed(1)}s elapsed)`);
    }

    const level1 = decisionsByLevel.get(1)!;
    const level2 = decisionsByLevel.get(2)!;
    const level3 = decisionsByLevel.get(3)!;
    const keys = [...level2.keys()];
    const n = keys.length;

    let choiceDiff12 = 0,
      choiceDiff23 = 0,
      choiceDiff13 = 0;
    for (const key of keys) {
      const d1 = level1.get(key)!,
        d2 = level2.get(key)!,
        d3 = level3.get(key)!;
      if (d1.chosenPspId !== d2.chosenPspId) choiceDiff12++;
      if (d2.chosenPspId !== d3.chosenPspId) choiceDiff23++;
      if (d1.chosenPspId !== d3.chosenPspId) choiceDiff13++;
    }

    const resampleIndices = generateResampleIndices(n, 2000, `${scenarioId}|richness`);
    const levelSummaries = LEVELS.map((level) => {
      const decisions = keys.map((k) => decisionsByLevel.get(level)!.get(k)!);
      const authIndicator = decisions.map((d) => (d.authorized ? 1 : 0));
      const authorizedCosts = decisions.filter((d) => d.authorized).map((d) => d.netCostEUR);
      return {
        level,
        authorizationRate: bootstrapMeanCI(authIndicator, resampleIndices),
        netCostPerAuthorized: bootstrapMeanCIStandalone(authorizedCosts, 2000, `${scenarioId}|richness|level${level}|netcost`),
        okCount: decisions.filter((d) => d.jevStatus === "ok").length,
        invalidCount: decisions.filter((d) => d.jevStatus === "invalid").length,
        failedCount: decisions.filter((d) => d.jevStatus === "failed").length,
      };
    });

    const elapsedSec = (Date.now() - started) / 1000;
    console.log(`\n--- ${scenarioId} data richness summary (${elapsedSec.toFixed(1)}s) ---`);
    for (const s of levelSummaries) {
      console.log(
        `level ${s.level}: auth=${(s.authorizationRate.mean * 100).toFixed(2)}% [${(s.authorizationRate.lo * 100).toFixed(2)}, ${(s.authorizationRate.hi * 100).toFixed(2)}] ` +
          `netCost=€${s.netCostPerAuthorized.mean.toFixed(4)} ok=${s.okCount} invalid=${s.invalidCount} failed=${s.failedCount}`
      );
    }
    console.log(`choice changed 1->2: ${choiceDiff12}/${n} (${((choiceDiff12 / n) * 100).toFixed(2)}%)`);
    console.log(`choice changed 2->3: ${choiceDiff23}/${n} (${((choiceDiff23 / n) * 100).toFixed(2)}%)`);
    console.log(`choice changed 1->3: ${choiceDiff13}/${n} (${((choiceDiff13 / n) * 100).toFixed(2)}%)`);

    const outPath = join(PROJECT_ROOT, "experiments", "results", `data-richness-${scenarioId}.json`);
    writeFileSync(outPath, JSON.stringify({ scenarioId, n, levelSummaries, choiceDiff12, choiceDiff23, choiceDiff13 }, null, 2));
    console.log(`Wrote ${outPath}`);
  }
}

main();
