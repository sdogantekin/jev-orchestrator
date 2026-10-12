import type { PspConfig } from "../domain/psp.js";
import type { PspId } from "../domain/types.js";

/**
 * The Decision Schema (section 8.3): an explicit, code-generated description of the decision,
 * never hand-written text scattered across the codebase. The actual API request (request.ts)
 * is derived from this, and the UI shows this schema directly.
 */
export const PSP_SELECTION_DECISION_ID = "psp_selection";
export const PSP_SELECTION_DECISION_VERSION = "1";

export interface MetricDefinition {
  id: string;
  description: string;
}

export interface DecisionOption {
  id: PspId;
  description: string;
}

export interface DecisionSchema {
  decisionId: string;
  decisionVersion: string;
  name: string;
  type: "choice";
  question: string;
  objective: string;
  metrics: MetricDefinition[];
  options: DecisionOption[];
}

/**
 * Jev doesn't know what "acceptance_rate" means in payments unless told (section 8.2) — every
 * field that appears in a PSP's state entry (state.ts) must have a matching definition here.
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "acceptance_rate_overall",
    description:
      "Share of this PSP's past attempts, across all transaction types, that ended in a successful authorization. 1.0 means all succeeded, 0.0 means none did.",
  },
  {
    id: "acceptance_rate_segment",
    description:
      "Same as acceptance_rate_overall, but restricted to past attempts matching this transaction's currency, country, payment method and amount range. More specific, but based on fewer attempts.",
  },
  {
    id: "availability_rate_overall",
    description: "Share of this PSP's past attempts where it was reachable at all, independent of whether the payment was then authorized.",
  },
  {
    id: "chargeback_rate_overall",
    description: "Share of this PSP's past authorized payments that were later reversed by the cardholder's bank (a chargeback).",
  },
  {
    id: "average_latency_ms",
    description: "This PSP's average response time in milliseconds, estimated from past attempts.",
  },
  {
    id: "retry_success_rate",
    description:
      "Share of this PSP's declined first attempts that succeeded on a later retry. Not used to decide this first attempt; shown for context only.",
  },
  {
    id: "sample_size",
    description: "Number of past attempts behind a rate value. A rate based on very few attempts is less reliable than one based on many.",
  },
  {
    id: "fixed_fee_eur",
    description: "Fixed fee in EUR this PSP charges per authorized payment, regardless of amount.",
  },
  {
    id: "cost_percent",
    description: "Variable fee this PSP charges per authorized payment, as a percent of the transaction amount.",
  },
  {
    id: "expected_fee_eur",
    description: "The fee in EUR this PSP would charge for this specific transaction if the payment is authorized: amount * cost_percent + fixed_fee_eur.",
  },
  {
    id: "recent_segment_outcomes",
    description:
      "This PSP's most recent past attempts matching this transaction's segment, most recent first, each \"authorized\" or \"declined\". Only present at the highest data-richness level.",
  },
];

const OBJECTIVE =
  "Choose the payment service provider most likely to result in a successful authorization for this specific transaction. If two providers seem comparably likely to authorize it, prefer the one with the lower expected fee.";

/**
 * Builds the schema from the currently eligible PSPs (section 8.4: never hardcoded to three
 * IDs). The option description is each PSP's general business role (e.g. "EU specialist") —
 * the kind of thing a payments team would know from a contract or dashboard, not a hidden
 * world value. See docs/assumptions.md.
 */
export function buildDecisionSchema(eligiblePsps: PspConfig[]): DecisionSchema {
  return {
    decisionId: PSP_SELECTION_DECISION_ID,
    decisionVersion: PSP_SELECTION_DECISION_VERSION,
    name: "Payment provider selection",
    type: "choice",
    question: "Which payment service provider should handle this transaction's first attempt?",
    objective: OBJECTIVE,
    metrics: METRIC_DEFINITIONS,
    options: eligiblePsps.map((psp) => ({
      id: psp.id,
      description: `${psp.name} — ${psp.role}.`,
    })),
  };
}
