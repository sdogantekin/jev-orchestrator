import { describe, expect, it } from "vitest";
import { bootstrapMeanCI, bootstrapMeanCIStandalone, generateResampleIndices } from "./metrics.js";

describe("generateResampleIndices", () => {
  it("is deterministic for the same seed", () => {
    const a = generateResampleIndices(10, 5, "seed-x");
    const b = generateResampleIndices(10, 5, "seed-x");
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    const a = generateResampleIndices(10, 5, "seed-x");
    const b = generateResampleIndices(10, 5, "seed-y");
    expect(a).not.toEqual(b);
  });

  it("produces indices within [0, n)", () => {
    const resamples = generateResampleIndices(7, 20, "seed-bounds");
    for (const resample of resamples) {
      expect(resample.length).toBe(7);
      for (const i of resample) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(7);
      }
    }
  });
});

describe("bootstrapMeanCI", () => {
  it("matches a hand-computed mean for a known array", () => {
    // mean of [0,0,0,0,1,1,1,1,1,1] = 6/10 = 0.6
    const values = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    const resampleIndices = generateResampleIndices(values.length, 2000, "hand-check");
    const ci = bootstrapMeanCI(values, resampleIndices);
    expect(ci.mean).toBeCloseTo(0.6, 10);
    expect(ci.n).toBe(10);
    expect(ci.lo).toBeLessThanOrEqual(ci.mean);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.mean);
  });

  it("gives a tight interval around a constant array", () => {
    const values = new Array(50).fill(1);
    const resampleIndices = generateResampleIndices(values.length, 1000, "constant-check");
    const ci = bootstrapMeanCI(values, resampleIndices);
    expect(ci.mean).toBe(1);
    expect(ci.lo).toBe(1);
    expect(ci.hi).toBe(1);
  });

  it("reuses the same resample indices across two different value arrays (paired comparison)", () => {
    const resampleIndices = generateResampleIndices(20, 500, "paired-check");
    const a = [...new Array(10).fill(1), ...new Array(10).fill(0)];
    const b = [...new Array(15).fill(1), ...new Array(5).fill(0)];
    const ciA = bootstrapMeanCI(a, resampleIndices);
    const ciB = bootstrapMeanCI(b, resampleIndices);
    expect(ciA.mean).toBeCloseTo(0.5, 10);
    expect(ciB.mean).toBeCloseTo(0.75, 10);
  });

  it("returns NaNs for an empty array rather than dividing by zero", () => {
    const ci = bootstrapMeanCI([], []);
    expect(Number.isNaN(ci.mean)).toBe(true);
    expect(ci.n).toBe(0);
  });
});

describe("bootstrapMeanCIStandalone", () => {
  it("matches bootstrapMeanCI with internally generated indices", () => {
    const values = [10, 20, 30, 40];
    const ci = bootstrapMeanCIStandalone(values, 1000, "standalone-check");
    expect(ci.mean).toBe(25);
  });

  it("handles an empty array", () => {
    const ci = bootstrapMeanCIStandalone([], 100, "empty-check");
    expect(Number.isNaN(ci.mean)).toBe(true);
  });
});
