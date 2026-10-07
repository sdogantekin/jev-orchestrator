import { z } from "zod";
import { PspConfigSchema, type PspConfig } from "./psp.js";
import {
  AMOUNT_BUCKETS,
  COUNTRIES,
  CURRENCIES,
  CUSTOMER_TYPES,
  DEVICES,
  PAYMENT_METHODS,
  PSP_IDS,
  type PspId,
  type Transaction,
} from "./types.js";

/**
 * A hidden segment modifier (section 5.2). World-only: routers never see these, only their
 * effect on the authorization draw. All specified fields in `when` must match for the delta
 * to apply; an unspecified field matches any value.
 */
export const SegmentModifierSchema = z.object({
  pspId: z.enum(PSP_IDS),
  description: z.string(),
  delta: z.number(),
  when: z.object({
    currency: z.enum(CURRENCIES).optional(),
    countryIn: z.array(z.enum(COUNTRIES)).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    amountBucket: z.enum(AMOUNT_BUCKETS).optional(),
    customerType: z.enum(CUSTOMER_TYPES).optional(),
    device: z.enum(DEVICES).optional(),
    threeDsEligible: z.boolean().optional(),
  }),
});
export type SegmentModifier = z.infer<typeof SegmentModifierSchema>;

/** Drift event (section 5.6): a PSP's base acceptance rate changes at and after a given index. */
export const DriftSchema = z.object({
  startIndex: z.number().int().nonnegative(),
  pspId: z.enum(PSP_IDS),
  acceptanceDelta: z.number(),
});
export type Drift = z.infer<typeof DriftSchema>;

export const WorldConfigSchema = z.object({
  psps: z.array(PspConfigSchema).length(3),
  segmentModifiers: z.array(SegmentModifierSchema),
  drift: DriftSchema.nullable(),
});
export type WorldConfig = z.infer<typeof WorldConfigSchema>;

export function getPsp(world: WorldConfig, pspId: PspId): PspConfig {
  const psp = world.psps.find((p) => p.id === pspId);
  if (!psp) throw new Error(`Unknown PSP id: ${pspId}`);
  return psp;
}

function modifierMatches(when: SegmentModifier["when"], tx: Transaction): boolean {
  if (when.currency !== undefined && when.currency !== tx.currency) return false;
  if (when.countryIn !== undefined && !when.countryIn.includes(tx.country)) return false;
  if (when.paymentMethod !== undefined && when.paymentMethod !== tx.paymentMethod) return false;
  if (when.amountBucket !== undefined && when.amountBucket !== tx.amountBucket) return false;
  if (when.customerType !== undefined && when.customerType !== tx.customerType) return false;
  if (when.device !== undefined && when.device !== tx.device) return false;
  if (when.threeDsEligible !== undefined && when.threeDsEligible !== tx.threeDsEligible) return false;
  return true;
}

/**
 * True acceptance probability for a PSP on a transaction, at a given stream index: base rate,
 * plus every matching hidden segment modifier, plus drift if the index has reached it. Clamped
 * to [0, 1] since modifiers are additive and could otherwise push outside the probability range.
 */
export function worldAcceptanceRate(
  world: WorldConfig,
  pspId: PspId,
  tx: Transaction,
  transactionIndex: number
): number {
  const psp = getPsp(world, pspId);
  let rate = psp.baseAcceptanceRate;

  for (const modifier of world.segmentModifiers) {
    if (modifier.pspId === pspId && modifierMatches(modifier.when, tx)) {
      rate += modifier.delta;
    }
  }

  if (world.drift && world.drift.pspId === pspId && transactionIndex >= world.drift.startIndex) {
    rate += world.drift.acceptanceDelta;
  }

  return Math.min(1, Math.max(0, rate));
}
