import type { DecisionSchema } from "./schema.js";
import type { JevState } from "./state.js";

/** Section 8.1: the documented request shape, confirmed in docs/jev-api-notes.md. */
export interface ChoiceQuestionPayload {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface DecisionsApiRequest {
  model: string;
  state: JevState;
  questions: Record<string, ChoiceQuestionPayload>;
}

/**
 * Derives the wire-level request from the Decision Schema and state (section 8.3: "the request
 * to Jev is derived from this schema, not from hand-written text scattered across the code").
 */
export function buildDecisionsRequest(schema: DecisionSchema, state: JevState, model: string): DecisionsApiRequest {
  const criteria: Record<string, string> = {};
  for (const option of schema.options) {
    criteria[option.id] = option.description;
  }

  const metricGlossary = schema.metrics.map((m) => `- ${m.id}: ${m.description}`).join("\n");

  const instructions = [schema.question, "", `Objective: ${schema.objective}`, "", "Metric definitions:", metricGlossary].join("\n");

  return {
    model,
    state,
    questions: {
      [schema.decisionId]: {
        type: "choice",
        instructions,
        criteria,
      },
    },
  };
}
