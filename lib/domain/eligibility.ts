import type { PspConfig } from "./psp.js";
import type { Transaction } from "./types.js";

export type IneligibilityReason = "disabled" | "currency_unsupported" | "payment_method_unsupported";

export interface EligibilityResult {
  pspId: PspConfig["id"];
  eligible: boolean;
  reasons: IneligibilityReason[];
}

/** Hard eligibility rules (section 7). Run before any router; routers never see excluded PSPs. */
export function checkEligibility(psp: PspConfig, tx: Transaction): EligibilityResult {
  const reasons: IneligibilityReason[] = [];
  if (!psp.enabled) reasons.push("disabled");
  if (!psp.supportedCurrencies.includes(tx.currency)) reasons.push("currency_unsupported");
  if (!psp.supportedPaymentMethods.includes(tx.paymentMethod)) reasons.push("payment_method_unsupported");
  return { pspId: psp.id, eligible: reasons.length === 0, reasons };
}

export function eligiblePsps(psps: PspConfig[], tx: Transaction): PspConfig[] {
  return psps.filter((psp) => checkEligibility(psp, tx).eligible);
}
