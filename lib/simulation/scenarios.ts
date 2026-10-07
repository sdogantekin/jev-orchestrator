import { z } from "zod";
import { PspConfigSchema } from "../domain/psp.js";
import { AMOUNT_BUCKETS, COUNTRIES, CURRENCIES, PAYMENT_METHODS, PSP_IDS } from "../domain/types.js";
import { DriftSchema, type WorldConfig } from "../domain/world.js";
import type { BackgroundHistoryLimit, ObservedViewConfig } from "./observedView.js";
import type { StreamConfig } from "./streamConfig.js";

export const SCENARIO_IDS = [
  "stable",
  "drift",
  "thin_data",
  "cold_start",
  "conflicting_objectives",
  "eligibility_mix",
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

const BackgroundHistoryLimitSchema = z.object({
  pspId: z.enum(PSP_IDS),
  segmentKey: z
    .object({
      currency: z.enum(CURRENCIES).optional(),
      country: z.enum(COUNTRIES).optional(),
      paymentMethod: z.enum(PAYMENT_METHODS).optional(),
      amountBucket: z.enum(AMOUNT_BUCKETS).optional(),
    })
    .optional(),
  maxAttempts: z.number().int().positive(),
});

/**
 * One scenario (section 5.6): a named set of overrides on top of the base world and stream
 * config. `worldPspOverrides` replaces whole PSP configs (used by "conflicting objectives");
 * `streamOverrides` replaces whole weight blocks (used by "eligibility mix" and "conflicting
 * objectives"); `backgroundHistoryLimits` thins observed history (used by "thin data" and
 * "cold start"); `drift` degrades a PSP mid-stream (used by "drift").
 */
export const ScenarioConfigSchema = z.object({
  id: z.enum(SCENARIO_IDS),
  name: z.string(),
  description: z.string(),
  worldPspOverrides: z
    .object({ alpha: PspConfigSchema.optional(), beta: PspConfigSchema.optional(), gamma: PspConfigSchema.optional() })
    .optional(),
  drift: DriftSchema.nullable().optional(),
  streamOverrides: z
    .object({
      amountBucketWeights: z
        .object({ small: z.number().nonnegative(), medium: z.number().nonnegative(), large: z.number().nonnegative() })
        .optional(),
      paymentMethod: z
        .object({ card: z.number().nonnegative(), paypal: z.number().nonnegative(), sepa_debit: z.number().nonnegative() })
        .optional(),
    })
    .optional(),
  backgroundHistoryLimits: z.array(BackgroundHistoryLimitSchema).optional(),
});
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

export interface ResolvedScenario {
  world: WorldConfig;
  stream: StreamConfig;
  observedView: ObservedViewConfig;
}

/** Merge a scenario's overrides onto the base world, stream and observed-view config. */
export function resolveScenario(
  scenario: ScenarioConfig,
  base: { world: WorldConfig; stream: StreamConfig; observedView: Omit<ObservedViewConfig, "backgroundHistoryLimits"> }
): ResolvedScenario {
  const world: WorldConfig = {
    psps: base.world.psps.map((psp) => {
      const override = scenario.worldPspOverrides?.[psp.id];
      return override ? { ...psp, ...override } : psp;
    }),
    segmentModifiers: base.world.segmentModifiers,
    drift: scenario.drift ?? null,
  };

  const stream: StreamConfig = {
    ...base.stream,
    amount: scenario.streamOverrides?.amountBucketWeights
      ? { ...base.stream.amount, bucketWeights: scenario.streamOverrides.amountBucketWeights }
      : base.stream.amount,
    paymentMethod: scenario.streamOverrides?.paymentMethod ?? base.stream.paymentMethod,
  };

  const observedView: ObservedViewConfig = {
    ...base.observedView,
    backgroundHistoryLimits: (scenario.backgroundHistoryLimits ?? []) as BackgroundHistoryLimit[],
  };

  return { world, stream, observedView };
}
