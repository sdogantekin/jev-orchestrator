import { readFileSync } from "node:fs";
import { join } from "node:path";
import PlaygroundClient, { type PresetExamples } from "../components/PlaygroundClient";
import { PROJECT_ROOT } from "../lib/simulation/configLoader";

export const metadata = { title: "Playground — Payment Decision Lab" };

function loadPresets(): PresetExamples {
  const raw = readFileSync(join(PROJECT_ROOT, "experiments", "results", "preset-examples.json"), "utf-8");
  return JSON.parse(raw) as PresetExamples;
}

export default function PlaygroundPage() {
  const presets = loadPresets();
  return <PlaygroundClient presets={presets} />;
}
