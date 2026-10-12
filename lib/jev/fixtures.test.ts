import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DecisionsApiResponse } from "./response.js";
import { fixturePath, loadFixture, saveFixture } from "./fixtures.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jev-fixtures-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sampleResponse: DecisionsApiResponse = {
  model: "typesafe/jev-1.13",
  answers: { psp_selection: { type: "choice", choice: "alpha", probabilities: { alpha: 1 }, confidence: 0.9 } },
  usage: { input_tokens: 500, output_tokens: 40, cost: 0.00002 },
};

describe("fixtures", () => {
  it("returns null for a hash with no saved fixture", () => {
    expect(loadFixture("missing-hash", dir)).toBeNull();
  });

  it("round-trips a saved fixture back out unchanged", () => {
    saveFixture("abc123", sampleResponse, dir);
    const loaded = loadFixture("abc123", dir);
    expect(loaded).toEqual(sampleResponse);
  });

  it("writes to a predictable path keyed by hash", () => {
    saveFixture("abc123", sampleResponse, dir);
    expect(fixturePath("abc123", dir)).toBe(join(dir, "abc123.json"));
  });

  it("validates the fixture's shape on load, not just on save", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(fixturePath("bad-hash", dir), JSON.stringify({ not: "valid" }));
    expect(() => loadFixture("bad-hash", dir)).toThrow();
  });
});
