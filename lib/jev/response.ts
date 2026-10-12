import { z } from "zod";

/**
 * Section 8.1/8.5 and docs/jev-api-notes.md: the confirmed response shape. `confidence` is
 * optional in the schema on purpose (section 8.5.4: "show confidence only if the API
 * returns it" — never invent one if it's absent).
 */
export const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1).optional(),
});
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;

export const UsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cost: z.number().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const DecisionsApiResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), ChoiceAnswerSchema),
  usage: UsageSchema.optional(),
  id: z.string().optional(),
  provider: z.string().optional(),
});
export type DecisionsApiResponse = z.infer<typeof DecisionsApiResponseSchema>;
