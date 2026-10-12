/**
 * Builds the static "preset scenario" examples the Playground serves for free, instantly, and
 * reliably (section 10.3) — no live call, no rate limit, just a replay of a real recorded
 * decision. Fixture-only (decideWithJev with allowLive: false), so this costs nothing to run.
 *
 * For each of the 6 scenarios, picks the first test-slice transaction (by seed 1, scanning
 * forward) where Jev and R2 disagree — the "disagreement highlight" the playground is built
 * around (section 10.1) — plus the first one where they agree, for contrast.
 *
 * Run with: npx tsx experiments/scripts/generate-preset-examples.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eligiblePsps } from "../../lib/domain/eligibility.js";
import { createInMemoryCache } from "../../lib/jev/cache.js";
import { decideWithJev } from "../../lib/jev/decide.js";
import { getJevModel } from "../../lib/jev/config.js";
import { buildDecisionSchema } from "../../lib/jev/schema.js";
import { buildJevState } from "../../lib/jev/state.js";
import { buildDecisionsRequest } from "../../lib/jev/request.js";
import { createRuleRouter, r1Router, RuleParamsSchema } from "../../lib/routers/ruleRouter.js";
import { computeObservedView, type ObservedPspStats } from "../../lib/simulation/observedView.js";
import { simulatePspOutcome } from "../../lib/simulation/outcome.js";
import { generateStream } from "../../lib/simulation/stream.js";
import { resolveScenario, SCENARIO_IDS } from "../../lib/simulation/scenarios.js";
import {
  CONFIG_DIR,
  PROJECT_ROOT,
  loadCurrencyConversion,
  loadObservedViewBase,
  loadScenarioConfig,
  loadStreamConfig,
  loadWorldConfig,
} from "../../lib/simulation/configLoader.js";
import { evalSeed, TEST_SLICE } from "../../lib/experiments/seeds.js";
import type { PspId } from "../../lib/domain/types.js";

const model = getJevModel();

async function main() {
  const baseWorld = loadWorldConfig();
  const baseStream = loadStreamConfig();
  const baseObservedView = loadObservedViewBase();
  const rates = loadCurrencyConversion();

  const examples: Record<string, unknown> = {};

  for (const scenarioId of SCENARIO_IDS) {
    const resolved = resolveScenario(loadScenarioConfig(scenarioId), { world: baseWorld, stream: baseStream, observedView: baseObservedView });
    const tunedParams = RuleParamsSchema.parse(JSON.parse(readFileSync(join(CONFIG_DIR, "tuned", `${scenarioId}.json`), "utf-8")));
    const r2Router = createRuleRouter(tunedParams);

    const seed = evalSeed(scenarioId, 1);
    const stream = generateStream(seed, 1000, resolved.stream, rates);
    const cache = createInMemoryCache();

    let disagreementExample: unknown = null;
    let agreementExample: unknown = null;

    for (let t = TEST_SLICE.start; t <= TEST_SLICE.end && (!disagreementExample || !agreementExample); t++) {
      const tx = stream[t]!;
      const eligible = eligiblePsps(resolved.world.psps, tx);
      if (eligible.length < 2) continue;

      const observed: Partial<Record<PspId, ObservedPspStats>> = {};
      for (const psp of eligible) observed[psp.id] = computeObservedView(stream, t, tx, psp, resolved.world, seed, resolved.observedView);

      const r1Choice = r1Router({ tx, eligible, observed });
      const r2Choice = r2Router({ tx, eligible, observed });

      const jevResult = await decideWithJev({ tx, eligible, observed, dataRichnessLevel: 2, model, cache, allowLive: false });
      if (jevResult.status !== "ok") continue;

      const schema = buildDecisionSchema(eligible);
      const state = buildJevState({ tx, eligible, observed, dataRichnessLevel: 2 });
      const request = buildDecisionsRequest(schema, state, model);

      const outcomesByPsp = Object.fromEntries(eligible.map((p) => [p.id, simulatePspOutcome(seed, t, tx, p, resolved.world)]));

      const example = {
        scenarioId,
        transactionIndex: t,
        transaction: tx,
        eligiblePspIds: eligible.map((p) => p.id),
        observed,
        schema,
        request,
        rawResponse: jevResult.rawResponse,
        jevChoice: jevResult.choice,
        jevProbabilities: jevResult.probabilities,
        jevConfidence: jevResult.confidence,
        r1Choice,
        r2Choice,
        outcomesByPsp,
      };

      const isDisagreement = jevResult.choice !== r2Choice;
      if (isDisagreement && !disagreementExample) disagreementExample = example;
      if (!isDisagreement && !agreementExample) agreementExample = example;
    }

    examples[scenarioId] = { disagreement: disagreementExample, agreement: agreementExample };
    console.log(`${scenarioId}: disagreement=${disagreementExample ? "found" : "NONE FOUND"} agreement=${agreementExample ? "found" : "NONE FOUND"}`);
  }

  const outPath = join(PROJECT_ROOT, "experiments", "results", "preset-examples.json");
  writeFileSync(outPath, JSON.stringify(examples, null, 2));
  console.log(`Wrote ${outPath}`);
}

main();
