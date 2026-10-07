import { z } from "zod";
import { CURRENCIES, PAYMENT_METHODS, PSP_IDS } from "./types.js";

/** Section 5.2 base world table, per PSP. Transaction cost percent is a percentage (1.3 means 1.3%). */
export const PspConfigSchema = z.object({
  id: z.enum(PSP_IDS),
  name: z.string(),
  role: z.string(),
  enabled: z.boolean(),
  supportedCurrencies: z.array(z.enum(CURRENCIES)),
  supportedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)),
  baseAcceptanceRate: z.number().min(0).max(1),
  transactionCostPercent: z.number().min(0),
  fixedFee: z.number().min(0),
  retrySuccessRate: z.number().min(0).max(1),
  chargebackRate: z.number().min(0).max(1),
  latencyCentralMs: z.number().positive(),
  availabilityRate: z.number().min(0).max(1),
});
export type PspConfig = z.infer<typeof PspConfigSchema>;
