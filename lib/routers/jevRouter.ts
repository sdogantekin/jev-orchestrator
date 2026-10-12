import type { PspId } from "../domain/types.js";
import type { JevCache } from "../jev/cache.js";
import { decideWithJev, type JevDecisionResult } from "../jev/decide.js";
import type { callJevDecisions } from "../jev/client.js";
import type { DataRichnessLevel } from "../jev/state.js";
import type { RouterInput } from "./types.js";

export interface JevRouterOptions {
  dataRichnessLevel: DataRichnessLevel;
  model: string;
  cache: JevCache;
  recentSegmentOutcomes?: Partial<Record<PspId, boolean[]>>;
  useFixtures?: boolean;
  allowLive?: boolean;
  apiKey?: string;
  timeoutMs?: number;
  callClient?: typeof callJevDecisions;
  fixturesDir?: string;
}

/**
 * R3 (section 6): Jev selects the PSP from the same observed view every other router gets.
 * Unlike R0-R2, this is async (it may involve a network call) and can come back `invalid` or
 * `failed` instead of a PSP id (section 8.5.5) — the caller (the batch runner, build step 4)
 * decides whether to fall back to R1 and how to count it. This step only wires the adapter up
 * as something a router-shaped caller can use; it is not hooked into the batch runner yet.
 */
export async function runJevRouter(input: RouterInput, options: JevRouterOptions): Promise<JevDecisionResult> {
  return decideWithJev({
    tx: input.tx,
    eligible: input.eligible,
    observed: input.observed,
    recentSegmentOutcomes: options.recentSegmentOutcomes,
    dataRichnessLevel: options.dataRichnessLevel,
    model: options.model,
    cache: options.cache,
    useFixtures: options.useFixtures,
    allowLive: options.allowLive,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
    callClient: options.callClient,
    fixturesDir: options.fixturesDir,
  });
}
