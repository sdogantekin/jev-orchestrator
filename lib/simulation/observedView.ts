import { checkEligibility } from "../domain/eligibility.js";
import type { PspConfig } from "../domain/psp.js";
import { segmentKeyEquals, segmentKeyOf, type PspId, type SegmentKey, type Transaction } from "../domain/types.js";
import type { WorldConfig } from "../domain/world.js";
import { highVolumeAttempts, type HighVolumeHistoryConfig } from "./backgroundHistory.js";
import { simulatePspOutcome } from "./outcome.js";

export interface ObservedStat {
  value: number | null;
  sampleSize: number;
}

export interface ObservedPspStats {
  pspId: PspId;
  acceptanceOverall: ObservedStat;
  acceptanceSegment: ObservedStat;
  availabilityOverall: ObservedStat;
  chargebackOverall: ObservedStat;
  averageLatencyMs: ObservedStat;
  /** Passthrough world value: retries are not simulated in v1, so there is no observation model for it. */
  retrySuccessRate: number;
}

/**
 * A scenario override that caps how many eligible background attempts feed a PSP's observed
 * stats (sections 5.6 "thin data" and "cold start"). When `segmentKey` is given, the cap
 * applies only to that exact segment; when omitted, it applies uniformly to the overall
 * aggregate and to every segment query for that PSP.
 */
export interface BackgroundHistoryLimit {
  pspId: PspId;
  segmentKey?: Partial<SegmentKey>;
  maxAttempts: number;
}

export interface ObservedViewConfig {
  lag: number;
  window: number;
  backgroundHistoryLimits: BackgroundHistoryLimit[];
  /** v2 only: observed stats come from a separate, larger background stream instead of the main stream. */
  highVolumeHistory?: HighVolumeHistoryConfig;
}

function partialSegmentMatches(partial: Partial<SegmentKey> | undefined, key: SegmentKey): boolean {
  if (!partial) return true;
  if (partial.currency !== undefined && partial.currency !== key.currency) return false;
  if (partial.country !== undefined && partial.country !== key.country) return false;
  if (partial.paymentMethod !== undefined && partial.paymentMethod !== key.paymentMethod) return false;
  if (partial.amountBucket !== undefined && partial.amountBucket !== key.amountBucket) return false;
  return true;
}

function findLimit(
  limits: BackgroundHistoryLimit[],
  pspId: PspId,
  queriedSegmentKey: SegmentKey | null
): BackgroundHistoryLimit | undefined {
  return limits.find((limit) => {
    if (limit.pspId !== pspId) return false;
    if (limit.segmentKey === undefined) return true;
    if (queriedSegmentKey === null) return false;
    return partialSegmentMatches(limit.segmentKey, queriedSegmentKey);
  });
}

/**
 * Eligible background attempts for one PSP, ending at `t - lag`, optionally filtered to a
 * segment. Section 5.5: these come from the background history (the transaction stream
 * itself), not from router choices, so every eligible historical transaction contributes
 * regardless of which PSP any router actually picked for it.
 *
 * Normally the window is `[t - lag - window, t - lag]`. If a `BackgroundHistoryLimit` matches,
 * the window is widened to the PSP's full lifetime (`[0, t - lag]`) and the result is capped to
 * the most recent `maxAttempts` eligible attempts, modeling thin/short-lived history rather than
 * a narrow recency window.
 */
function gatherBackgroundAttempts(
  stream: Transaction[],
  seed: string,
  t: number,
  psp: PspConfig,
  world: WorldConfig,
  cfg: ObservedViewConfig,
  segmentKey: SegmentKey | null
): ReturnType<typeof simulatePspOutcome>[] {
  const hi = t - cfg.lag;
  if (hi < 0) return [];

  const limit = findLimit(cfg.backgroundHistoryLimits, psp.id, segmentKey);
  const lo = limit ? 0 : Math.max(0, t - cfg.lag - cfg.window);

  let attempts: ReturnType<typeof simulatePspOutcome>[] = [];
  if (cfg.highVolumeHistory) {
    attempts = highVolumeAttempts(cfg.highVolumeHistory, world, seed, psp, lo, hi, (tx) => !segmentKey || segmentKeyEquals(segmentKeyOf(tx), segmentKey));
  } else {
    for (let i = lo; i <= hi; i++) {
      const tx = stream[i];
      if (!tx) continue;
      if (!checkEligibility(psp, tx).eligible) continue;
      if (segmentKey && !segmentKeyEquals(segmentKeyOf(tx), segmentKey)) continue;
      attempts.push(simulatePspOutcome(seed, i, tx, psp, world));
    }
  }

  if (limit && attempts.length > limit.maxAttempts) {
    return attempts.slice(attempts.length - limit.maxAttempts);
  }
  return attempts;
}

function rate(count: number, denominator: number): ObservedStat {
  return { value: denominator > 0 ? count / denominator : null, sampleSize: denominator };
}

function aggregate(attempts: ReturnType<typeof simulatePspOutcome>[]): {
  acceptance: ObservedStat;
  availability: ObservedStat;
  chargeback: ObservedStat;
  averageLatency: ObservedStat;
} {
  const total = attempts.length;
  const authorizedCount = attempts.filter((a) => a.authorized).length;
  const availableCount = attempts.filter((a) => a.available).length;
  const chargebackCount = attempts.filter((a) => a.chargeback).length;
  const latencies = attempts.map((a) => a.latencyMs).filter((l): l is number => l !== null);

  return {
    acceptance: rate(authorizedCount, total),
    availability: rate(availableCount, total),
    chargeback: rate(chargebackCount, authorizedCount),
    averageLatency: {
      value: latencies.length > 0 ? latencies.reduce((s, l) => s + l, 0) / latencies.length : null,
      sampleSize: latencies.length,
    },
  };
}

/**
 * Data richness level 3 (section 8.6): the outcomes of a PSP's most recent eligible attempts
 * in the same segment as `currentTx`, most recent first, capped at `limit`. Reuses the same
 * background-attempt gathering as the aggregated stats, so it inherits the same
 * scenario-specific thin/cold-start caps automatically.
 */
export function computeRecentSegmentOutcomes(
  stream: Transaction[],
  transactionIndex: number,
  currentTx: Transaction,
  psp: PspConfig,
  world: WorldConfig,
  seed: string,
  cfg: ObservedViewConfig,
  limit = 20
): boolean[] {
  const segmentKey = segmentKeyOf(currentTx);
  const attempts = gatherBackgroundAttempts(stream, seed, transactionIndex, psp, world, cfg, segmentKey);
  return attempts
    .slice(Math.max(0, attempts.length - limit))
    .reverse()
    .map((a) => a.authorized);
}

/** v2 high-volume path only: observed stats are expensive there and R2 tuning asks for the same ones ~1,500 times. */
const highVolumeMemo = new WeakMap<ObservedViewConfig, WeakMap<WorldConfig, Map<string, ObservedPspStats>>>();

export function computeObservedView(
  stream: Transaction[],
  transactionIndex: number,
  currentTx: Transaction,
  psp: PspConfig,
  world: WorldConfig,
  seed: string,
  cfg: ObservedViewConfig
): ObservedPspStats {
  if (!cfg.highVolumeHistory) return computeObservedViewUncached(stream, transactionIndex, currentTx, psp, world, seed, cfg);
  let byWorld = highVolumeMemo.get(cfg);
  if (!byWorld) highVolumeMemo.set(cfg, (byWorld = new WeakMap()));
  let memo = byWorld.get(world);
  if (!memo) byWorld.set(world, (memo = new Map()));
  const key = `${seed}|${transactionIndex}|${psp.id}`;
  let stats = memo.get(key);
  if (!stats) memo.set(key, (stats = computeObservedViewUncached(stream, transactionIndex, currentTx, psp, world, seed, cfg)));
  return stats;
}

function computeObservedViewUncached(
  stream: Transaction[],
  transactionIndex: number,
  currentTx: Transaction,
  psp: PspConfig,
  world: WorldConfig,
  seed: string,
  cfg: ObservedViewConfig
): ObservedPspStats {
  const overallAttempts = gatherBackgroundAttempts(stream, seed, transactionIndex, psp, world, cfg, null);
  const segmentKey = segmentKeyOf(currentTx);
  const segmentAttempts = gatherBackgroundAttempts(stream, seed, transactionIndex, psp, world, cfg, segmentKey);

  const overall = aggregate(overallAttempts);
  const segment = aggregate(segmentAttempts);

  return {
    pspId: psp.id,
    acceptanceOverall: overall.acceptance,
    acceptanceSegment: segment.acceptance,
    availabilityOverall: overall.availability,
    chargebackOverall: overall.chargeback,
    averageLatencyMs: overall.averageLatency,
    retrySuccessRate: psp.retrySuccessRate,
  };
}
