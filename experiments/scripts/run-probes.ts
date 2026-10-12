/**
 * Probes (section 9.3): single-decision tests of Jev's behavior. Live calls, deliberately
 * bypassing the cache/fixture layer (decide.ts) since the point is independent live draws, not
 * cost-saving. The calibration probe is NOT run here — it's derived for free from the main
 * comparison's already-collected probabilities and simulated outcomes (see
 * experiments/scripts/run-jev-main-batch.ts's calibration output), so it needs no separate
 * live calls.
 *
 * Run with: node --env-file=.env ./node_modules/.bin/tsx experiments/scripts/run-probes.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PspConfig } from "../../lib/domain/psp.js";
import { getJevModel } from "../../lib/jev/config.js";
import type { DecisionsApiRequest } from "../../lib/jev/request.js";
import { METRIC_DEFINITIONS } from "../../lib/jev/schema.js";
import { PROJECT_ROOT, loadWorldConfig } from "../../lib/simulation/configLoader.js";
import { baselineObserved, baselineTransaction, buildRequest, callProbe } from "../../lib/experiments/probes.js";

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set.");
    process.exit(1);
  }
  const model = getJevModel();
  const world = loadWorldConfig();
  const results: Record<string, unknown> = {};

  results.responsiveness = await runResponsiveness(model, apiKey, world.psps);
  results.tradeOff = await runTradeOff(model, apiKey);
  results.irrelevance = await runIrrelevance(model, apiKey, world.psps);
  results.repeatability = await runRepeatability(model, apiKey, world.psps);

  const outPath = join(PROJECT_ROOT, "experiments", "results", "probes.json");
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);
}

// ---------------------------------------------------------------------------
// Responsiveness: raise one PSP's observed acceptance in steps, hold the rest fixed.
// ---------------------------------------------------------------------------
async function runResponsiveness(model: string, apiKey: string, allPsps: PspConfig[]) {
  // Clean head-to-head against one fixed competitor (not three PSPs), with the swept PSP's
  // acceptance crossing from clearly below to clearly above the competitor's fixed value —
  // otherwise, if the swept PSP never actually becomes the best option, there's no reason its
  // probability should rise, and that's not a meaningful test of H1.
  const fixedCompetitor = allPsps.find((p) => p.id === "alpha")!; // fixed at its real base rate (0.945)
  const sweptPsp = allPsps.find((p) => p.id === "gamma")!;
  const psps = [fixedCompetitor, sweptPsp];

  const tx = baselineTransaction();
  const steps = [0.75, 0.8, 0.85, 0.9, 0.93, 0.945, 0.96, 0.98, 0.99];
  const repeats = 3;
  const rows: Array<{ acceptanceStep: number; repeat: number; choice: string; sweptPspProbability: number }> = [];

  for (const step of steps) {
    const observed = baselineObserved(psps, {
      [sweptPsp.id]: { acceptanceOverall: { value: step, sampleSize: 150 }, acceptanceSegment: { value: step, sampleSize: 30 } },
    });
    const request = buildRequest(tx, psps, observed, model);
    for (let r = 0; r < repeats; r++) {
      const result = await callProbe(request, apiKey, "psp_selection");
      const sweptProb = result.probabilities[sweptPsp.id] ?? 0;
      rows.push({ acceptanceStep: step, repeat: r, choice: result.choice, sweptPspProbability: sweptProb });
      console.log(`responsiveness: ${sweptPsp.id} acceptance=${step} (vs ${fixedCompetitor.id} fixed at ${fixedCompetitor.baseAcceptanceRate}) rep=${r} -> choice=${result.choice} ${sweptPsp.id}Prob=${sweptProb}`);
    }
  }
  return { fixedCompetitorId: fixedCompetitor.id, fixedCompetitorAcceptance: fixedCompetitor.baseAcceptanceRate, sweptPspId: sweptPsp.id, rows };
}

// ---------------------------------------------------------------------------
// Trade-off: small amounts should lean cheaper, large amounts should lean higher-acceptance.
// ---------------------------------------------------------------------------
async function runTradeOff(model: string, apiKey: string) {
  const expensive: PspConfig = {
    id: "alpha",
    name: "PSP Alpha",
    role: "Premium",
    enabled: true,
    supportedCurrencies: ["EUR"],
    supportedPaymentMethods: ["card"],
    baseAcceptanceRate: 0.94,
    transactionCostPercent: 2.0,
    fixedFee: 0.3,
    retrySuccessRate: 0.3,
    chargebackRate: 0.001,
    latencyCentralMs: 400,
    availabilityRate: 0.999,
  };
  // Acceptance gap deliberately small (1 point) so the two are "comparably likely to
  // authorize" per the schema's own objective text, making fee the plausible tie-breaker.
  const cheap: PspConfig = {
    ...expensive,
    id: "beta",
    name: "PSP Beta",
    role: "Budget",
    baseAcceptanceRate: 0.93,
    transactionCostPercent: 0.5,
    fixedFee: 0.1,
  };
  const psps = [expensive, cheap];
  const observed = baselineObserved(psps);
  const repeats = 5;
  const rows: Array<{ amountBucket: string; amountEUR: number; repeat: number; choice: string }> = [];

  for (const [label, amount] of [["small", 10], ["large", 800]] as const) {
    const tx = baselineTransaction({ amount, amountEUR: amount, amountBucket: label === "small" ? "small" : "large" });
    const request = buildRequest(tx, psps, observed, model);
    for (let r = 0; r < repeats; r++) {
      const result = await callProbe(request, apiKey, "psp_selection");
      rows.push({ amountBucket: label, amountEUR: amount, repeat: r, choice: result.choice });
      console.log(`trade-off: amount=${label} (€${amount}) rep=${r} -> choice=${result.choice}`);
    }
  }
  return { expensivePspId: expensive.id, cheapPspId: cheap.id, rows };
}

// ---------------------------------------------------------------------------
// Irrelevance: shuffle PSP order, rename display names, reorder fields, add an unrelated
// field. The choice should not move.
// ---------------------------------------------------------------------------
async function runIrrelevance(model: string, apiKey: string, psps: PspConfig[]) {
  const tx = baselineTransaction();
  const observed = baselineObserved(psps);
  const repeats = 3;
  const rows: Array<{ variant: string; repeat: number; choice: string }> = [];

  const variants: Array<{ name: string; request: DecisionsApiRequest }> = [
    { name: "baseline", request: buildRequest(tx, psps, observed, model) },
    { name: "shuffled_psp_order", request: buildRequest(tx, [psps[2]!, psps[0]!, psps[1]!], observed, model) },
    {
      name: "renamed_display_names",
      request: buildRequest(
        tx,
        psps.map((p) => ({ ...p, name: `Provider ${p.id.toUpperCase()}`, role: "General payment provider" })),
        observed,
        model
      ),
    },
    { name: "reordered_metric_glossary", request: withShuffledMetricGlossary(buildRequest(tx, psps, observed, model)) },
    { name: "unrelated_field_added", request: withUnrelatedField(buildRequest(tx, psps, observed, model)) },
  ];

  for (const variant of variants) {
    for (let r = 0; r < repeats; r++) {
      const result = await callProbe(variant.request, apiKey, "psp_selection");
      rows.push({ variant: variant.name, repeat: r, choice: result.choice });
      console.log(`irrelevance: variant=${variant.name} rep=${r} -> choice=${result.choice}`);
    }
  }
  return { rows };
}

function withShuffledMetricGlossary(request: DecisionsApiRequest): DecisionsApiRequest {
  const shuffled = [...METRIC_DEFINITIONS].reverse();
  const glossary = shuffled.map((m) => `- ${m.id}: ${m.description}`).join("\n");
  const question = request.questions.psp_selection!;
  const [firstLine, , objectiveLine] = question.instructions.split("\n");
  const newInstructions = [firstLine, "", objectiveLine, "", "Metric definitions:", glossary].join("\n");
  return { ...request, questions: { psp_selection: { ...question, instructions: newInstructions } } };
}

function withUnrelatedField(request: DecisionsApiRequest): DecisionsApiRequest {
  return { ...request, state: { ...request.state, _unrelated_debug_marker: "this field means nothing" } as never };
}

// ---------------------------------------------------------------------------
// Repeatability: same state, 20 independent live calls. How often does the choice change?
// ---------------------------------------------------------------------------
async function runRepeatability(model: string, apiKey: string, psps: PspConfig[]) {
  const tx = baselineTransaction();
  const observed = baselineObserved(psps);
  const request = buildRequest(tx, psps, observed, model);
  const rows: Array<{ call: number; choice: string; probabilities: Record<string, number>; confidence?: number }> = [];

  for (let i = 0; i < 20; i++) {
    const result = await callProbe(request, apiKey, "psp_selection");
    rows.push({ call: i, choice: result.choice, probabilities: result.probabilities, confidence: result.confidence });
    console.log(`repeatability: call=${i} -> choice=${result.choice} confidence=${result.confidence}`);
  }

  const distinctChoices = new Set(rows.map((r) => r.choice));
  return { rows, distinctChoiceCount: distinctChoices.size };
}

main();
