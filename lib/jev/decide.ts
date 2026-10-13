import type { PspConfig } from "../domain/psp.js";
import type { PspId, Transaction } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";
import type { JevCache } from "./cache.js";
import { hashDecisionRequest } from "./cache.js";
import { callJevDecisions } from "./client.js";
import { loadFixture, saveFixture } from "./fixtures.js";
import { buildDecisionsRequest, type DecisionsApiRequest } from "./request.js";
import type { DecisionsApiResponse, Usage } from "./response.js";
import { buildDecisionSchema, type DecisionSchema } from "./schema.js";
import { buildJevState, type DataRichnessLevel } from "./state.js";

export type JevDecisionSource = "cache" | "fixture" | "live";

export interface JevDecisionOk {
  status: "ok";
  source: JevDecisionSource;
  choice: PspId;
  probabilities: Record<string, number>;
  confidence?: number;
  usage?: Usage;
  schema: DecisionSchema;
  request: DecisionsApiRequest;
  rawResponse: DecisionsApiResponse;
}

/** Section 14: "Jev returned a decision outside the eligible PSP set. The route was rejected by validation." */
export interface JevDecisionInvalid {
  status: "invalid";
  reason: string;
  schema: DecisionSchema;
  request: DecisionsApiRequest;
}

/** Section 8.5.5: a failed or unreachable call. Never invents a decision — callers decide whether to fall back to R1. */
export interface JevDecisionFailed {
  status: "failed";
  reason: string;
  schema: DecisionSchema;
  request: DecisionsApiRequest;
}

export type JevDecisionResult = JevDecisionOk | JevDecisionInvalid | JevDecisionFailed;

export interface DecideWithJevArgs {
  tx: Transaction;
  eligible: PspConfig[];
  observed: Partial<Record<PspId, ObservedPspStats>>;
  recentSegmentOutcomes?: Partial<Record<PspId, boolean[]>>;
  dataRichnessLevel: DataRichnessLevel;
  model: string;
  cache: JevCache;
  /** Whether to check/write the committed fixture store. Default true. */
  useFixtures?: boolean;
  /** Whether a live call may be made when nothing is cached or recorded. Default false — the safe default for tests/CI. */
  allowLive?: boolean;
  apiKey?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the real network call. */
  callClient?: typeof callJevDecisions;
  fixturesDir?: string;
}

/**
 * Builds the schema/state/request, resolves a response (cache, then committed fixture, then —
 * only if explicitly allowed — a live call), and validates it (section 8.5). Never throws for
 * an expected failure mode (unreachable, invalid shape, choice outside the eligible set) —
 * those come back as a typed `invalid`/`failed` result for the caller to record and handle
 * (e.g. falling back to R1, per section 8.5.5).
 */
export async function decideWithJev(args: DecideWithJevArgs): Promise<JevDecisionResult> {
  const schema = buildDecisionSchema(args.eligible);
  const state = buildJevState({
    tx: args.tx,
    eligible: args.eligible,
    observed: args.observed,
    recentSegmentOutcomes: args.recentSegmentOutcomes,
    dataRichnessLevel: args.dataRichnessLevel,
  });
  const request = buildDecisionsRequest(schema, state, args.model);
  const hash = hashDecisionRequest(request);
  const useFixtures = args.useFixtures ?? true;

  let response: DecisionsApiResponse;
  let source: JevDecisionSource;

  const cached = args.cache.get(hash);
  if (cached) {
    response = cached.response;
    source = "cache";
  } else {
    const fixture = useFixtures ? loadFixture(hash, args.fixturesDir) : null;
    if (fixture) {
      response = fixture;
      source = "fixture";
      args.cache.set(hash, { response });
    } else if (args.allowLive) {
      if (!args.apiKey) {
        return { status: "failed", reason: "Live call requested but no API key was provided.", schema, request };
      }
      const callClient = args.callClient ?? callJevDecisions;
      try {
        response = await callClient(request, { apiKey: args.apiKey, timeoutMs: args.timeoutMs });
      } catch (err) {
        return { status: "failed", reason: err instanceof Error ? err.message : "Jev could not be reached.", schema, request };
      }
      source = "live";
      args.cache.set(hash, { response });
      if (useFixtures) saveFixture(hash, response, args.fixturesDir);
    } else {
      return { status: "failed", reason: "No cached or recorded response for this state, and live calls are disabled.", schema, request };
    }
  }

  const answer = response.answers[schema.decisionId];
  if (!answer) {
    return { status: "failed", reason: `Jev's response did not include an answer for "${schema.decisionId}".`, schema, request };
  }
  if (!args.eligible.some((p) => p.id === answer.choice)) {
    return {
      status: "invalid",
      reason: "Jev returned a decision outside the eligible PSP set. The route was rejected by validation.",
      schema,
      request,
    };
  }

  return {
    status: "ok",
    source,
    choice: answer.choice as PspId,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
    usage: response.usage,
    schema,
    request,
    rawResponse: response,
  };
}
