import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../simulation/configLoader.js";
import type { ScenarioId } from "../simulation/scenarios.js";
import { RuleParamsSchema, type RuleParams } from "./ruleRouter.js";

/** Server-only: reads R2's grid-search-tuned params for a scenario from experiments/config/tuned/. */
export function loadTunedRuleParams(scenarioId: ScenarioId): RuleParams {
  const raw = JSON.parse(readFileSync(join(CONFIG_DIR, "tuned", `${scenarioId}.json`), "utf-8"));
  return RuleParamsSchema.parse(raw);
}
