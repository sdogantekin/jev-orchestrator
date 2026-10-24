import { computeNetCost } from "../domain/fees.js";
import type { PspConfig } from "../domain/psp.js";
import type { Transaction } from "../domain/types.js";
import { worldAcceptanceRate, type WorldConfig } from "../domain/world.js";
import { bernoulli, pspDraw } from "./rng.js";

export interface PspOutcome {
  pspId: PspConfig["id"];
  available: boolean;
  authorized: boolean;
  latencyMs: number | null;
  chargeback: boolean;
  worldAcceptanceRate: number;
  feeEUR: number;
  chargebackLossEUR: number;
  netCostEUR: number;
}

/**
 * The simulated outcome for one PSP on one transaction (section 5.3). A pure function of
 * (seed, transactionIndex, psp, world, tx): it does not depend on which router picked the PSP,
 * so two routers choosing the same PSP for the same transaction always get this same result
 * (common random numbers).
 *
 * `worldTimeIndex` is the point on the main stream's timeline used for drift; it defaults to
 * `transactionIndex`. Only the v2 high-volume background history sets it, since there many
 * background transactions share one point in main-stream time.
 */
export function simulatePspOutcome(
  seed: string,
  transactionIndex: number,
  tx: Transaction,
  psp: PspConfig,
  world: WorldConfig,
  chargebackFixedFeeEUR?: number,
  worldTimeIndex: number = transactionIndex
): PspOutcome {
  const available = bernoulli(psp.availabilityRate, pspDraw(seed, transactionIndex, psp.id, "availability"));

  const acceptanceRate = worldAcceptanceRate(world, psp.id, tx, worldTimeIndex);
  const authorized =
    available && bernoulli(acceptanceRate, pspDraw(seed, transactionIndex, psp.id, "authorization"));

  const latencyVariation = (pspDraw(seed, transactionIndex, psp.id, "latency") * 2 - 1) * 0.2;
  const latencyMs = available ? psp.latencyCentralMs * (1 + latencyVariation) : null;

  const chargeback =
    authorized && bernoulli(psp.chargebackRate, pspDraw(seed, transactionIndex, psp.id, "chargeback"));

  const cost = computeNetCost({ authorized, chargeback, psp, amountEUR: tx.amountEUR, chargebackFixedFeeEUR });

  return {
    pspId: psp.id,
    available,
    authorized,
    latencyMs,
    chargeback,
    worldAcceptanceRate: acceptanceRate,
    ...cost,
  };
}
