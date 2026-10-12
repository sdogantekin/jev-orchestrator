import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eligiblePsps } from "../domain/eligibility.js";
import { createInMemoryCache } from "../jev/cache.js";
import { loadCurrencyConversion, loadObservedViewBase, loadStreamConfig, loadWorldConfig } from "../simulation/configLoader.js";
import { computeObservedView, type ObservedViewConfig } from "../simulation/observedView.js";
import { generateStream } from "../simulation/stream.js";
import { runJevRouter } from "./jevRouter.js";

/**
 * End-to-end demonstration that the adapter works against a real transaction and a mocked
 * client — the "adapter works against mocks" half of checkpoint C4 — without any network call
 * or API key.
 */
describe("runJevRouter end-to-end against a mocked client", () => {
  const world = loadWorldConfig();
  const streamConfig = loadStreamConfig();
  const rates = loadCurrencyConversion();
  const observedViewBase = loadObservedViewBase();
  const cfg: ObservedViewConfig = { ...observedViewBase, backgroundHistoryLimits: [] };

  let fixturesDir: string;
  beforeEach(() => {
    fixturesDir = mkdtempSync(join(tmpdir(), "jev-router-e2e-test-"));
  });
  afterEach(() => {
    rmSync(fixturesDir, { recursive: true, force: true });
  });

  it("routes a real transaction to whichever PSP the mocked client answers with", async () => {
    const seed = "jev-router-e2e";
    const stream = generateStream(seed, 1000, streamConfig, rates);
    const transactionIndex = 500;
    const tx = stream[transactionIndex]!;
    const eligible = eligiblePsps(world.psps, tx);
    expect(eligible.length).toBeGreaterThanOrEqual(2);

    const observed = {} as Record<(typeof eligible)[number]["id"], ReturnType<typeof computeObservedView>>;
    for (const psp of eligible) {
      observed[psp.id] = computeObservedView(stream, transactionIndex, tx, psp, world, seed, cfg);
    }

    const pickedId = eligible[1]!.id;
    const result = await runJevRouter(
      { tx, eligible, observed },
      {
        dataRichnessLevel: 2,
        model: "typesafe/jev-1.13",
        cache: createInMemoryCache(),
        fixturesDir,
        allowLive: true,
        apiKey: "mock-key",
        callClient: async () => ({
          model: "typesafe/jev-1.13",
          answers: {
            psp_selection: {
              type: "choice",
              choice: pickedId,
              probabilities: Object.fromEntries(eligible.map((p) => [p.id, p.id === pickedId ? 0.8 : 0.1])),
              confidence: 0.77,
            },
          },
          usage: { input_tokens: 420, output_tokens: 25, cost: 0.0000176 },
        }),
      }
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.choice).toBe(pickedId);
      expect(result.source).toBe("live");
      expect(result.confidence).toBe(0.77);
      expect(Object.keys(result.probabilities).sort()).toEqual(eligible.map((p) => p.id).sort());
    }
  });

  it("comes back invalid, not a thrown error, if the mocked client answers with an ineligible PSP", async () => {
    const seed = "jev-router-e2e-invalid";
    const stream = generateStream(seed, 1000, streamConfig, rates);
    const transactionIndex = 10; // before the lag has elapsed, so observed data is still null
    const tx = stream[transactionIndex]!;
    const eligible = eligiblePsps(world.psps, tx).slice(0, 1); // force only one PSP "eligible" for this test
    const observed = { [eligible[0]!.id]: computeObservedView(stream, transactionIndex, tx, eligible[0]!, world, seed, cfg) } as never;

    const notEligibleId = world.psps.find((p) => p.id !== eligible[0]!.id)!.id;
    const result = await runJevRouter(
      { tx, eligible, observed },
      {
        dataRichnessLevel: 1,
        model: "typesafe/jev-1.13",
        cache: createInMemoryCache(),
        fixturesDir,
        allowLive: true,
        apiKey: "mock-key",
        callClient: async () => ({
          model: "typesafe/jev-1.13",
          answers: { psp_selection: { type: "choice", choice: notEligibleId, probabilities: { [notEligibleId]: 1 } } },
        }),
      }
    );

    expect(result.status).toBe("invalid");
  });
});
