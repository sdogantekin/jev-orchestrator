import type { CurrencyConversion } from "../domain/currency.js";
import { checkEligibility } from "../domain/eligibility.js";
import type { PspConfig } from "../domain/psp.js";
import type { Transaction } from "../domain/types.js";
import type { WorldConfig } from "../domain/world.js";
import { simulatePspOutcome, type PspOutcome } from "./outcome.js";
import { generateTransaction } from "./stream.js";
import type { StreamConfig } from "./streamConfig.js";

/**
 * v2 "high volume" background history: the platform sees `perTransaction` background
 * transactions for every transaction on the main stream, so observed stats are computed from
 * far more attempts than in v1 (where the background history is the main stream itself).
 * Background transaction j sits at main-stream time floor(j / perTransaction), which is what
 * the lag/window and drift are measured against. It uses its own seed, so it never shares
 * random draws with the main stream.
 */
export interface HighVolumeHistoryConfig {
  perTransaction: number;
  stream: StreamConfig;
  conversionRates: CurrencyConversion;
}

interface PspHistory {
  /** Eligible attempts only, in background-index order. */
  attempts: { tx: Transaction; outcome: PspOutcome }[];
  /** How many background transactions have been generated so far (eligible or not). */
  generated: number;
}

const cache = new WeakMap<HighVolumeHistoryConfig, WeakMap<WorldConfig, Map<string, PspHistory>>>();

function historyFor(hv: HighVolumeHistoryConfig, world: WorldConfig, seed: string, psp: PspConfig): PspHistory {
  let byWorld = cache.get(hv);
  if (!byWorld) cache.set(hv, (byWorld = new WeakMap()));
  let byKey = byWorld.get(world);
  if (!byKey) byWorld.set(world, (byKey = new Map()));
  const key = `${seed}|${psp.id}`;
  let history = byKey.get(key);
  if (!history) byKey.set(key, (history = { attempts: [], generated: 0 }));
  return history;
}

/** Index of the first attempt whose background index is >= j. */
function lowerBound(attempts: PspHistory["attempts"], j: number): number {
  let lo = 0;
  let hi = attempts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (attempts[mid]!.tx.index < j) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** One PSP's eligible background attempts with main-stream time in [mainTimeLo, mainTimeHi], optionally filtered. */
export function highVolumeAttempts(
  hv: HighVolumeHistoryConfig,
  world: WorldConfig,
  seed: string,
  psp: PspConfig,
  mainTimeLo: number,
  mainTimeHi: number,
  filter: (tx: Transaction) => boolean
): PspOutcome[] {
  const history = historyFor(hv, world, seed, psp);
  const needed = (mainTimeHi + 1) * hv.perTransaction;
  const bgSeed = `${seed}|background`;
  for (let j = history.generated; j < needed; j++) {
    const tx = generateTransaction(bgSeed, j, hv.stream, hv.conversionRates);
    if (!checkEligibility(psp, tx).eligible) continue;
    const outcome = simulatePspOutcome(bgSeed, j, tx, psp, world, undefined, Math.floor(j / hv.perTransaction));
    history.attempts.push({ tx, outcome });
  }
  history.generated = Math.max(history.generated, needed);

  const out: PspOutcome[] = [];
  const jHi = needed - 1;
  for (let i = lowerBound(history.attempts, mainTimeLo * hv.perTransaction); i < history.attempts.length; i++) {
    const a = history.attempts[i]!;
    if (a.tx.index > jHi) break;
    if (filter(a.tx)) out.push(a.outcome);
  }
  return out;
}
