import { z } from "zod";
import { CARD_SCHEMES, CURRENCIES, CUSTOMER_TYPES, DEVICES, PAYMENT_METHODS, COUNTRIES, PSP_IDS } from "../domain/types.js";

/** Section 5.7: every field a visitor can edit, validated strictly server-side. Never free text. */
export const TransactionInputSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  currency: z.enum(CURRENCIES),
  country: z.enum(COUNTRIES),
  paymentMethod: z.enum(PAYMENT_METHODS),
  cardScheme: z.enum(CARD_SCHEMES).nullable(),
  device: z.enum(DEVICES),
  customerType: z.enum(CUSTOMER_TYPES),
  threeDsEligible: z.boolean(),
});
export type TransactionInput = z.infer<typeof TransactionInputSchema>;

export const PspInputSchema = z.object({
  id: z.enum(PSP_IDS),
  enabled: z.boolean(),
  supportedCurrencies: z.array(z.enum(CURRENCIES)).min(1),
  supportedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1),
  transactionCostPercent: z.number().min(0).max(10),
  fixedFee: z.number().min(0).max(100),
  acceptanceRate: z.number().min(0).max(1),
  retrySuccessRate: z.number().min(0).max(1),
  chargebackRate: z.number().min(0).max(1),
  latencyMs: z.number().min(1).max(10_000),
  availabilityRate: z.number().min(0).max(1),
  sampleSize: z.number().int().min(0).max(1_000_000),
});
export type PspInput = z.infer<typeof PspInputSchema>;

export const DecisionRequestSchema = z.object({
  transaction: TransactionInputSchema,
  psps: z.array(PspInputSchema).length(3),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
