import { describe, expect, it } from "vitest";
import { bernoulli, inverseNormalCDF, normalCDF, pspDraw, transactionDraw, unit } from "./rng.js";

describe("unit", () => {
  it("is deterministic for the same key", () => {
    expect(unit("seed-1|42|alpha|authorization")).toBe(unit("seed-1|42|alpha|authorization"));
  });

  it("differs across different keys (no accidental collisions in a small sample)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 1000; i++) values.add(unit(`seed|${i}|alpha|authorization`));
    expect(values.size).toBe(1000);
  });

  it("stays within [0, 1)", () => {
    for (let i = 0; i < 2000; i++) {
      const u = unit(`k${i}`);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it("is roughly uniform over a large sample (within 2 percentage points per decile)", () => {
    const buckets = new Array(10).fill(0);
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = unit(`uniformity-check|${i}`);
      buckets[Math.min(9, Math.floor(u * 10))]++;
    }
    for (const count of buckets) {
      expect(count / n).toBeGreaterThan(0.08);
      expect(count / n).toBeLessThan(0.12);
    }
  });
});

describe("pspDraw (common random numbers)", () => {
  it("depends only on (seed, index, pspId, step), not on call order or router identity", () => {
    const a = pspDraw("seed-A", 7, "alpha", "authorization");
    const b = pspDraw("seed-A", 7, "alpha", "authorization");
    expect(a).toBe(b);
  });

  it("gives different PSPs independent draws for the same transaction", () => {
    const alpha = pspDraw("seed-A", 7, "alpha", "authorization");
    const beta = pspDraw("seed-A", 7, "beta", "authorization");
    expect(alpha).not.toBe(beta);
  });

  it("gives different steps independent draws for the same PSP and transaction", () => {
    const auth = pspDraw("seed-A", 7, "alpha", "authorization");
    const avail = pspDraw("seed-A", 7, "alpha", "availability");
    expect(auth).not.toBe(avail);
  });

  it("gives different seeds different streams", () => {
    const a = pspDraw("seed-A", 7, "alpha", "authorization");
    const b = pspDraw("seed-B", 7, "alpha", "authorization");
    expect(a).not.toBe(b);
  });
});

describe("transactionDraw", () => {
  it("is deterministic and independent of pspDraw's keys", () => {
    const t1 = transactionDraw("seed-A", 7, "amount_bucket");
    const t2 = transactionDraw("seed-A", 7, "amount_bucket");
    expect(t1).toBe(t2);
    const p = pspDraw("seed-A", 7, "some-psp", "authorization");
    expect(t1).not.toBe(p);
  });
});

describe("bernoulli", () => {
  it("matches draw against probability threshold", () => {
    expect(bernoulli(0.5, 0.49)).toBe(true);
    expect(bernoulli(0.5, 0.51)).toBe(false);
    expect(bernoulli(0, 0)).toBe(false);
    expect(bernoulli(1, 0.999999)).toBe(true);
  });
});

describe("normalCDF / inverseNormalCDF", () => {
  it("round-trips through both directions", () => {
    for (const p of [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999]) {
      const z = inverseNormalCDF(p);
      expect(normalCDF(z)).toBeCloseTo(p, 6);
    }
  });

  it("normalCDF(0) is 0.5", () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 6);
  });

  it("inverseNormalCDF(0.5) is 0", () => {
    expect(inverseNormalCDF(0.5)).toBeCloseTo(0, 6);
  });
});
