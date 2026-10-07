/**
 * Checkpoint C2 (section 19.2): batch results for R0, R1, R2 on all six scenarios, 20 seeds,
 * with confidence intervals. Writes one JSON result file per scenario (used later by the
 * Results page) plus the tuned R2 parameters, and prints the C2 summary to the console.
 * Run with `npm run batch`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runScenarioBatch, type ScenarioBatchResult } from "../../lib/experiments/batchRunner.js";
import { loadCurrencyConversion, loadObservedViewBase, loadStreamConfig, loadWorldConfig, PROJECT_ROOT } from "../../lib/simulation/configLoader.js";
import { SCENARIO_IDS } from "../../lib/simulation/scenarios.js";

const baseWorld = loadWorldConfig();
const baseStream = loadStreamConfig();
const baseObservedView = loadObservedViewBase();
const conversionRates = loadCurrencyConversion();

const RESULTS_DIR = join(PROJECT_ROOT, "experiments", "results");
const TUNED_DIR = join(PROJECT_ROOT, "experiments", "config", "tuned");
mkdirSync(RESULTS_DIR, { recursive: true });
mkdirSync(TUNED_DIR, { recursive: true });

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function fmtCI(ci: { mean: number; lo: number; hi: number }, formatter: (x: number) => string): string {
  if (Number.isNaN(ci.mean)) return "n/a";
  return `${formatter(ci.mean)} [${formatter(ci.lo)}, ${formatter(ci.hi)}]`;
}

const allResults: ScenarioBatchResult[] = [];

for (const scenarioId of SCENARIO_IDS) {
  console.log(`\n=== Scenario: ${scenarioId} ===`);
  const started = Date.now();
  const result = runScenarioBatch({ scenarioId, conversionRates, baseWorld, baseStream, baseObservedView });
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  allResults.push(result);

  writeFileSync(join(RESULTS_DIR, `${scenarioId}.json`), JSON.stringify(result, null, 2));
  writeFileSync(join(TUNED_DIR, `${scenarioId}.json`), JSON.stringify(result.tunedR2Params, null, 2));

  console.log(`(tuned + evaluated in ${elapsedSec}s)`);
  console.log(`decisions (test slice, >=2 eligible): ${result.decisionCount}`);
  console.log(`single-eligible (excluded): ${result.singleEligibleCount}  zero-eligible (excluded): ${result.zeroEligibleCount}`);
  console.log(`tuned R2 params: ${JSON.stringify(result.tunedR2Params)}`);
  console.log("");
  console.log("router  auth rate [95% CI]              net cost / authorized [95% CI]     avg latency");
  for (const routerId of ["R0", "R1", "R2"] as const) {
    const m = result.metrics[routerId];
    console.log(
      `${routerId.padEnd(7)} ${fmtCI(m.authorizationRate, pct).padEnd(40)} ${fmtCI(m.netCostPerAuthorized, (x) => `€${x.toFixed(4)}`).padEnd(34)} ${m.averageLatencyMs.toFixed(0)}ms`
    );
  }

  const gap = result.metrics.R2.authorizationRate.mean - result.metrics.R0.authorizationRate.mean;
  console.log(`\nR2 - R0 authorization rate gap: ${(gap * 100).toFixed(2)} percentage points`);

  if (result.metrics.R1.authorizationRate.mean === result.metrics.R2.authorizationRate.mean) {
    console.log("FLAG: R1 and R2 have identical authorization rates on this scenario.");
  }
  const spread = Math.max(
    result.metrics.R0.authorizationRate.mean,
    result.metrics.R1.authorizationRate.mean,
    result.metrics.R2.authorizationRate.mean
  ) -
    Math.min(
      result.metrics.R0.authorizationRate.mean,
      result.metrics.R1.authorizationRate.mean,
      result.metrics.R2.authorizationRate.mean
    );
  if (spread < 0.005) {
    console.log(`FLAG: all routers score within ${(spread * 100).toFixed(2)} points of each other on this scenario.`);
  }
}

console.log("\n\n=== C2 summary across all scenarios ===\n");
console.log("scenario                 R0 auth    R1 auth    R2 auth    R2-R0 gap   single-elig   zero-elig");
for (const r of allResults) {
  const r0 = r.metrics.R0.authorizationRate.mean;
  const r1 = r.metrics.R1.authorizationRate.mean;
  const r2 = r.metrics.R2.authorizationRate.mean;
  console.log(
    `${r.scenarioId.padEnd(25)} ${pct(r0).padEnd(10)} ${pct(r1).padEnd(10)} ${pct(r2).padEnd(10)} ${((r2 - r0) * 100).toFixed(2).padStart(6)}pp     ${String(r.singleEligibleCount).padEnd(13)} ${r.zeroEligibleCount}`
  );
}
