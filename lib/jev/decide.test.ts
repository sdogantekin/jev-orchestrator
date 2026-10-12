import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PspConfig } from "../domain/psp.js";
import type { Transaction } from "../domain/types.js";
import { createInMemoryCache, hashDecisionRequest } from "./cache.js";
import type { JevClientOptions } from "./client.js";
import { decideWithJev } from "./decide.js";
import { saveFixture } from "./fixtures.js";
import { buildDecisionsRequest } from "./request.js";
import type { DecisionsApiResponse } from "./response.js";
import { buildDecisionSchema } from "./schema.js";
import { buildJevState } from "./state.js";

const alpha: PspConfig = {
  id: "alpha",
  name: "PSP Alpha",
  role: "Generalist",
  enabled: true,
  supportedCurrencies: ["EUR"],
  supportedPaymentMethods: ["card"],
  baseAcceptanceRate: 0.9,
  transactionCostPercent: 1,
  fixedFee: 0.2,
  retrySuccessRate: 0.3,
  chargebackRate: 0.001,
  latencyCentralMs: 300,
  availabilityRate: 0.99,
};
const beta: PspConfig = { ...alpha, id: "beta", name: "PSP Beta", role: "EU specialist" };

const tx: Transaction = {
  index: 1,
  amount: 60,
  amountEUR: 60,
  amountBucket: "medium",
  currency: "EUR",
  country: "DE",
  paymentMethod: "card",
  cardScheme: "visa",
  device: "desktop",
  customerType: "returning",
  threeDsEligible: false,
};

function expectedHash(eligible: PspConfig[]): string {
  const schema = buildDecisionSchema(eligible);
  const state = buildJevState({ tx, eligible, observed: {}, dataRichnessLevel: 2 });
  const request = buildDecisionsRequest(schema, state, "typesafe/jev-1.13");
  return hashDecisionRequest(request);
}

function okResponse(choice: string): DecisionsApiResponse {
  return {
    model: "typesafe/jev-1.13",
    answers: { psp_selection: { type: "choice", choice, probabilities: { alpha: choice === "alpha" ? 0.9 : 0.1, beta: choice === "beta" ? 0.9 : 0.1 }, confidence: 0.85 } },
    usage: { input_tokens: 400, output_tokens: 30, cost: 0.00001 },
  };
}

let fixturesDir: string;

beforeEach(() => {
  fixturesDir = mkdtempSync(join(tmpdir(), "jev-decide-test-"));
});

afterEach(() => {
  rmSync(fixturesDir, { recursive: true, force: true });
});

describe("decideWithJev", () => {
  it("fails safely by default when nothing is cached or fixtured, without calling any client", async () => {
    let clientCalled = false;
    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      fixturesDir,
      callClient: async () => {
        clientCalled = true;
        throw new Error("should not be called");
      },
    });
    expect(result.status).toBe("failed");
    expect(clientCalled).toBe(false);
  });

  it("does not call the client even if an apiKey is given, unless allowLive is explicitly true", async () => {
    let clientCalled = false;
    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      fixturesDir,
      apiKey: "some-key",
      callClient: async () => {
        clientCalled = true;
        throw new Error("should not be called");
      },
    });
    expect(result.status).toBe("failed");
    expect(clientCalled).toBe(false);
  });

  it("uses a cached response without touching fixtures or the client", async () => {
    const cache = createInMemoryCache();
    const hash = expectedHash([alpha, beta]);
    cache.set(hash, { response: okResponse("beta") });

    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache,
      fixturesDir,
      callClient: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.source).toBe("cache");
      expect(result.choice).toBe("beta");
    }
  });

  it("falls back to a committed fixture when the cache is empty, and populates the cache from it", async () => {
    const hash = expectedHash([alpha, beta]);
    saveFixture(hash, okResponse("alpha"), fixturesDir);
    const cache = createInMemoryCache();

    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache,
      fixturesDir,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.source).toBe("fixture");
    expect(cache.get(hash)).toBeDefined();
  });

  it("calls the injected client when allowLive is true and nothing is cached or fixtured, then records a fixture", async () => {
    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      fixturesDir,
      allowLive: true,
      apiKey: "test-key",
      callClient: async (_request, options: JevClientOptions) => {
        expect(options.apiKey).toBe("test-key");
        return okResponse("alpha");
      },
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.source).toBe("live");

    const hash = expectedHash([alpha, beta]);
    const { loadFixture } = await import("./fixtures.js");
    expect(loadFixture(hash, fixturesDir)).not.toBeNull();
  });

  it("returns a failed result (not a thrown error) when the client rejects", async () => {
    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      fixturesDir,
      allowLive: true,
      apiKey: "test-key",
      callClient: async () => {
        throw new Error("Jev could not be reached.");
      },
    });
    expect(result.status).toBe("failed");
  });

  it("returns invalid when the choice is outside the eligible PSP set (section 14)", async () => {
    const hash = expectedHash([alpha]); // only alpha eligible
    saveFixture(hash, okResponse("beta"), fixturesDir); // but the recorded answer says beta
    const result = await decideWithJev({
      tx,
      eligible: [alpha],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      fixturesDir,
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toContain("outside the eligible PSP set");
    }
  });

  it("returns failed when the response has no answer for our decision id", async () => {
    const hash = expectedHash([alpha, beta]);
    saveFixture(hash, { model: "typesafe/jev-1.13", answers: {} }, fixturesDir);
    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      fixturesDir,
    });
    expect(result.status).toBe("failed");
  });

  it("determinism: replaying the same fixture with a fresh cache always gives the same result", async () => {
    const hash = expectedHash([alpha, beta]);
    saveFixture(hash, okResponse("alpha"), fixturesDir);

    const run = () =>
      decideWithJev({
        tx,
        eligible: [alpha, beta],
        observed: {},
        dataRichnessLevel: 2,
        model: "typesafe/jev-1.13",
        cache: createInMemoryCache(), // fresh cache each time: forces a fixture read
        fixturesDir,
      });

    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });

  it("keeps the full probability distribution and only shows confidence when the response provided one", async () => {
    const hash = expectedHash([alpha, beta]);
    const response: DecisionsApiResponse = {
      model: "typesafe/jev-1.13",
      answers: { psp_selection: { type: "choice", choice: "alpha", probabilities: { alpha: 0.6, beta: 0.4 } } }, // no confidence
    };
    saveFixture(hash, response, fixturesDir);

    const result = await decideWithJev({
      tx,
      eligible: [alpha, beta],
      observed: {},
      dataRichnessLevel: 2,
      model: "typesafe/jev-1.13",
      cache: createInMemoryCache(),
      fixturesDir,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.probabilities).toEqual({ alpha: 0.6, beta: 0.4 });
      expect(result.confidence).toBeUndefined();
    }
  });
});
