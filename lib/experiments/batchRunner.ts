import type { CurrencyConversion } from "../domain/currency.js";
import type { StreamConfig } from "../simulation/streamConfig.js";
import type { WorldConfig } from "../domain/world.js";
import { naiveRouter } from "../routers/naive.js";
import { createRuleRouter, r1Router, type RuleParams } from "../routers/ruleRouter.js";
import { tuneR2 } from "../routers/tuning.js";
import { ROUTER_IDS, type RouterFn, type RouterId } from "../routers/types.js";
import { resolveScenario, type ScenarioId } from "../simulation/scenarios.js";
import { loadScenarioConfig } from "../simulation/configLoader.js";
import { bootstrapMeanCI, bootstrapMeanCIStandalone, generateResampleIndices, type ConfidenceInterval } from "./metrics.js";
import { evaluateRouters, type DecisionRecord } from "./evaluate.js";
import { EVAL_SEED_COUNT, evalSeed, STREAM_LENGTH, TEST_SLICE } from "./seeds.js";

export interface RouterMetrics {
  authorizationRate: ConfidenceInterval;
  netCostPerAuthorized: ConfidenceInterval;
  averageLatencyMs: number;
}

export interface ScenarioBatchResult {
  scenarioId: ScenarioId;
  tunedR2Params: RuleParams;
  singleEligibleCount: number;
  zeroEligibleCount: number;
  decisionCount: number;
  metrics: Record<RouterId, RouterMetrics>;
}

/**
 * Runs R0, R1 and tuned-R2 across the 20 evaluation seeds for one scenario's test slice
 * (section 9.2), and reports authorization rate and net cost per authorized transaction with
 * bootstrap confidence intervals (section 9.6). No Jev / R3 yet (build step 3).
 */
export function runScenarioBatch(args: {
  scenarioId: ScenarioId;
  conversionRates: CurrencyConversion;
  baseWorld: WorldConfig;
  baseStream: StreamConfig;
  baseObservedView: { lag: number; window: number };
  bootstrapIterations?: number;
}): ScenarioBatchResult {
  const scenarioConfig = loadScenarioConfig(args.scenarioId);
  const resolved = resolveScenario(scenarioConfig, {
    world: args.baseWorld,
    stream: args.baseStream,
    observedView: args.baseObservedView,
  });

  const tunedR2Params = tuneR2(resolved, args.scenarioId, args.conversionRates);

  const routers: Record<RouterId, RouterFn> = {
    R0: naiveRouter,
    R1: r1Router,
    R2: createRuleRouter(tunedR2Params),
  };

  const combinedDecisions: Record<RouterId, DecisionRecord[]> = { R0: [], R1: [], R2: [] };
  let singleEligibleCount = 0;
  let zeroEligibleCount = 0;

  for (let i = 1; i <= EVAL_SEED_COUNT; i++) {
    const seed = evalSeed(args.scenarioId, i);
    const { decisionsByRouter, singleEligibleCount: s, zeroEligibleCount: z } = evaluateRouters({
      scenario: resolved,
      seed,
      streamLength: STREAM_LENGTH,
      rangeStart: TEST_SLICE.start,
      rangeEnd: TEST_SLICE.end,
      conversionRates: args.conversionRates,
      routers,
    });
    singleEligibleCount += s;
    zeroEligibleCount += z;
    for (const id of ROUTER_IDS) combinedDecisions[id].push(...decisionsByRouter[id]!);
  }

  const n = combinedDecisions.R0.length;
  const bootstrapIterations = args.bootstrapIterations ?? 2000;
  const resampleIndices = generateResampleIndices(n, bootstrapIterations, `${args.scenarioId}|ci`);

  const metrics = {} as Record<RouterId, RouterMetrics>;
  for (const id of ROUTER_IDS) {
    const decisions = combinedDecisions[id];
    const authorizedIndicator = decisions.map((d) => (d.authorized ? 1 : 0));
    const authorizationRate = bootstrapMeanCI(authorizedIndicator, resampleIndices);

    const authorizedCosts = decisions.filter((d) => d.authorized).map((d) => d.netCostEUR);
    const netCostPerAuthorized = bootstrapMeanCIStandalone(authorizedCosts, bootstrapIterations, `${args.scenarioId}|${id}|netcost`);

    const latencies = decisions.map((d) => d.latencyMs).filter((l): l is number => l !== null);
    const averageLatencyMs = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : NaN;

    metrics[id] = { authorizationRate, netCostPerAuthorized, averageLatencyMs };
  }

  return {
    scenarioId: args.scenarioId,
    tunedR2Params,
    singleEligibleCount,
    zeroEligibleCount,
    decisionCount: n,
    metrics,
  };
}
