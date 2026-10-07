import { unit } from "../simulation/rng.js";

export interface ConfidenceInterval {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

/**
 * Deterministic bootstrap resample indices (section 9.6: "bootstrap over transactions, paired
 * by transaction index"). Generated once per comparison and reused across every router, so a
 * given resample draws the exact same observations from each router's results.
 */
export function generateResampleIndices(n: number, iterations: number, seed: string): number[][] {
  const result: number[][] = [];
  for (let b = 0; b < iterations; b++) {
    const indices = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      indices[j] = Math.floor(unit(`${seed}|bootstrap|${b}|${j}`) * n);
    }
    result.push(indices);
  }
  return result;
}

/** Percentile bootstrap CI for the mean of `values`, using a shared set of resample indices. */
export function bootstrapMeanCI(values: number[], resampleIndices: number[][]): ConfidenceInterval {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };

  const means = resampleIndices.map((indices) => {
    let sum = 0;
    for (const i of indices) sum += values[i]!;
    return sum / indices.length;
  });
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(0.025 * means.length)]!;
  const hi = means[Math.min(means.length - 1, Math.ceil(0.975 * means.length) - 1)]!;
  return { mean, lo, hi, n };
}

/** A plain (unpaired) bootstrap CI for a metric defined only on a router's own subset (e.g. net cost per authorized transaction). */
export function bootstrapMeanCIStandalone(values: number[], iterations: number, seed: string): ConfidenceInterval {
  if (values.length === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const indices = generateResampleIndices(values.length, iterations, seed);
  return bootstrapMeanCI(values, indices);
}
