import { readFileSync } from "node:fs";
import { join } from "node:path";
import PlaygroundClient, { type PresetExamples } from "../components/PlaygroundClient";
import { PROJECT_ROOT } from "../lib/simulation/configLoader";
import { DEFAULT_RULE_PARAMS, type RuleParams } from "../lib/routers/ruleRouter";
import { loadTunedRuleParams } from "../lib/routers/loadTunedParams";
import { SCENARIO_IDS, type ScenarioId } from "../lib/simulation/scenarios";

export const metadata = { title: "Playground — Payment Decision Lab" };

function loadPresets(): PresetExamples {
  const raw = readFileSync(join(PROJECT_ROOT, "experiments", "results", "preset-examples.json"), "utf-8");
  return JSON.parse(raw) as PresetExamples;
}

function loadR2ParamsByScenario(): Record<ScenarioId, RuleParams> {
  return Object.fromEntries(SCENARIO_IDS.map((id) => [id, loadTunedRuleParams(id)])) as Record<ScenarioId, RuleParams>;
}

export default function PlaygroundPage() {
  const presets = loadPresets();
  const r2ParamsByScenario = loadR2ParamsByScenario();
  return <PlaygroundClient presets={presets} r1Params={DEFAULT_RULE_PARAMS} r2ParamsByScenario={r2ParamsByScenario} />;
}
