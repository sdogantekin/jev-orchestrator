import { createInMemoryCache } from "../jev/cache.js";
import { decideWithJev, type JevDecisionResult } from "../jev/decide.js";
import { loadTunedRuleParams } from "../routers/loadTunedParams.js";
import type { RuleParams } from "../routers/ruleRouter.js";
import { loadCurrencyConversion, loadStreamConfig } from "../simulation/configLoader.js";
import { resolveCustomState } from "./liveRouting.js";
import type { PspInput, TransactionInput } from "./schema.js";

/** R2 has no "custom mode" tuning to fall back to; the Stable scenario's tuned params are a reasonable generic default, shown as such in the UI. */
export function loadGenericR2Params(): RuleParams {
  return loadTunedRuleParams("stable");
}

/**
 * Server side of custom mode: eligibility, R1 and R2 are already computed live in the browser
 * (lib/playground/liveRouting.ts, reused here) the instant a visitor edits a field — the one
 * thing that needs a server round trip is Jev, a real billed/rate-limited model call, which only
 * happens when the visitor explicitly asks for it.
 */
export type JevOnlyResult =
  | { status: "zero_eligible" }
  | { status: "single_eligible"; chosenPspId: string }
  | { status: "ok"; jev: JevDecisionResult };

export async function runJevDecision(args: {
  transactionInput: TransactionInput;
  pspInputs: PspInput[];
  apiKey: string;
  allowLive: boolean;
}): Promise<JevOnlyResult> {
  const streamConfig = loadStreamConfig();
  const conversionRates = loadCurrencyConversion();
  const { tx, eligible, observed } = resolveCustomState(args.transactionInput, args.pspInputs, streamConfig.amount, conversionRates);

  if (eligible.length === 0) {
    return { status: "zero_eligible" };
  }
  if (eligible.length === 1) {
    return { status: "single_eligible", chosenPspId: eligible[0]!.id };
  }

  const jevResult = await decideWithJev({
    tx,
    eligible,
    observed,
    dataRichnessLevel: 2,
    model: process.env.JEV_MODEL?.trim() || "typesafe/jev-1.13",
    cache: createInMemoryCache(),
    allowLive: args.allowLive,
    apiKey: args.apiKey,
  });

  return { status: "ok", jev: jevResult };
}
