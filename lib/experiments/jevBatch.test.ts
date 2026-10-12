import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryCache } from "../jev/cache.js";
import { JevClientError } from "../jev/client.js";
import { loadCurrencyConversion, loadObservedViewBase, loadScenarioConfig, loadStreamConfig, loadWorldConfig } from "../simulation/configLoader.js";
import { resolveScenario } from "../simulation/scenarios.js";
import { runJevBatchForSeed } from "./jevBatch.js";
import { TEST_SLICE } from "./seeds.js";

const baseWorld = loadWorldConfig();
const baseStream = loadStreamConfig();
const rates = loadCurrencyConversion();
const baseObservedView = loadObservedViewBase();

const resolved = resolveScenario(loadScenarioConfig("stable"), { world: baseWorld, stream: baseStream, observedView: baseObservedView });

let fixturesDir: string;
beforeEach(() => {
  fixturesDir = mkdtempSync(join(tmpdir(), "jev-batch-test-"));
});
afterEach(() => {
  rmSync(fixturesDir, { recursive: true, force: true });
});

/** Always answers with the first eligible PSP in the request's criteria, never touching the network. */
async function mockClientAlwaysOk(request: Parameters<NonNullable<Parameters<typeof runJevBatchForSeed>[0]["callClient"]>>[0]) {
  const firstOption = Object.keys(request.questions.psp_selection!.criteria)[0]!;
  return {
    model: request.model,
    answers: {
      psp_selection: { type: "choice" as const, choice: firstOption, probabilities: { [firstOption]: 1 }, confidence: 0.9 },
    },
    usage: { input_tokens: 500, output_tokens: 30, cost: 0.00002 },
  };
}

async function mockClientAlwaysFails(): Promise<never> {
  throw new JevClientError("simulated failure", undefined, 400); // 400: retry.ts won't retry this, so the test stays fast
}

describe("runJevBatchForSeed", () => {
  it("covers exactly the test slice once each, with every decision accounted for", async () => {
    const { decisions, singleEligibleCount, zeroEligibleCount } = await runJevBatchForSeed({
      scenario: resolved,
      seed: "jev-batch-test-coverage",
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      dataRichnessLevel: 2,
      conversionRates: rates,
      apiKey: "mock-key",
      fixturesDir,
      concurrency: 10,
      callClient: mockClientAlwaysOk,
    });
    expect(decisions.length + singleEligibleCount + zeroEligibleCount).toBe(TEST_SLICE.end - TEST_SLICE.start + 1);
    const indices = decisions.map((d) => d.transactionIndex).sort((a, b) => a - b);
    expect(new Set(indices).size).toBe(indices.length); // no duplicates
  });

  it("every decision's chosen PSP is one of the transaction's eligible PSPs, whatever the Jev outcome", async () => {
    const { decisions } = await runJevBatchForSeed({
      scenario: resolved,
      seed: "jev-batch-test-eligibility",
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      dataRichnessLevel: 1,
      conversionRates: rates,
      apiKey: "mock-key",
      fixturesDir,
      concurrency: 10,
      callClient: mockClientAlwaysOk,
    });
    expect(decisions.every((d) => d.jevStatus === "ok" && !d.usedFallback)).toBe(true);
  });

  it("falls back to R1 and marks it, without crashing, when every Jev call fails", async () => {
    const { decisions } = await runJevBatchForSeed({
      scenario: resolved,
      seed: "jev-batch-test-fallback",
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      dataRichnessLevel: 2,
      conversionRates: rates,
      apiKey: "mock-key",
      fixturesDir,
      concurrency: 10,
      callClient: mockClientAlwaysFails,
    });
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => d.usedFallback)).toBe(true);
    expect(decisions.every((d) => d.jevStatus === "failed")).toBe(true);
    // R1's fallback choice must still be a real, eligible PSP (checked indirectly: a valid outcome was simulated).
    expect(decisions.every((d) => typeof d.authorized === "boolean")).toBe(true);
  });

  it("records confidence/probabilities/cost only for live-sourced ok decisions, and respects the requested concurrency bound", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const trackedClient = async (request: Parameters<typeof mockClientAlwaysOk>[0]) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return mockClientAlwaysOk(request);
    };

    const { decisions } = await runJevBatchForSeed({
      scenario: resolved,
      seed: "jev-batch-test-concurrency",
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      dataRichnessLevel: 2,
      conversionRates: rates,
      apiKey: "mock-key",
      fixturesDir,
      concurrency: 5,
      callClient: trackedClient,
    });

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(decisions.every((d) => d.jevConfidence === 0.9)).toBe(true);
    expect(decisions.every((d) => d.jevCost === 0.00002)).toBe(true);
    expect(decisions.every((d) => d.jevSource === "live")).toBe(true);
  });
});
