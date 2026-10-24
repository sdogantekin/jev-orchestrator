import { feeEUR } from "../domain/fees.js";
import type { PspConfig } from "../domain/psp.js";
import type { RouterFn } from "./types.js";

/** A segment with this many attempts counts as much as the PSP's overall rate. */
export const SHRINK_K = 100;

/**
 * v2 reference, not a competitor: "simple statistics done right". Blends each PSP's observed
 * segment acceptance with its overall acceptance, weighted by how many segment attempts there
 * are, and picks the highest. Answers "what can a basic data-following router get here?",
 * so Jev's v2 result can be read against it.
 */
export const statsReferenceRouter: RouterFn = ({ tx, eligible, observed }) => {
  const score = (p: PspConfig) => {
    const o = observed[p.id];
    const overall = o?.acceptanceOverall.value ?? -1;
    const seg = o?.acceptanceSegment;
    const blended = seg?.value != null ? (seg.value * seg.sampleSize + overall * SHRINK_K) / (seg.sampleSize + SHRINK_K) : overall;
    return blended - feeEUR(p, tx.amountEUR) * 1e-9; // fee only breaks exact ties
  };
  return eligible.reduce((best, p) => (score(p) > score(best) ? p : best)).id;
};
