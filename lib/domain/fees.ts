import type { PspConfig } from "./psp.js";

export const DEFAULT_CHARGEBACK_FIXED_FEE_EUR = 15;

/**
 * Fee and chargeback math (section 5.3), computed in EUR throughout. PSP fixed fees and the
 * chargeback fixed fee are treated as EUR-denominated constants (not documented in the
 * requirements doc; recorded as an assumption in docs/assumptions.md).
 */
export function feeEUR(psp: PspConfig, amountEUR: number): number {
  return amountEUR * (psp.transactionCostPercent / 100) + psp.fixedFee;
}

export function chargebackLossEUR(
  amountEUR: number,
  chargebackFixedFeeEUR: number = DEFAULT_CHARGEBACK_FIXED_FEE_EUR
): number {
  return amountEUR + chargebackFixedFeeEUR;
}

export interface NetCostBreakdown {
  feeEUR: number;
  chargebackLossEUR: number;
  netCostEUR: number;
}

/** Net cost of a transaction (section 9.1): fee if authorized, plus chargeback loss if one occurred. */
export function computeNetCost(args: {
  authorized: boolean;
  chargeback: boolean;
  psp: PspConfig;
  amountEUR: number;
  chargebackFixedFeeEUR?: number;
}): NetCostBreakdown {
  const fee = args.authorized ? feeEUR(args.psp, args.amountEUR) : 0;
  const cbLoss = args.authorized && args.chargeback ? chargebackLossEUR(args.amountEUR, args.chargebackFixedFeeEUR) : 0;
  return { feeEUR: fee, chargebackLossEUR: cbLoss, netCostEUR: fee + cbLoss };
}
