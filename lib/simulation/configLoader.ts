import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CurrencyConversionSchema, type CurrencyConversion } from "../domain/currency.js";
import { WorldConfigSchema, type WorldConfig } from "../domain/world.js";
import { ScenarioConfigSchema, type ScenarioConfig, type ScenarioId } from "./scenarios.js";
import { StreamConfigSchema, type StreamConfig } from "./streamConfig.js";

const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(here, "../..");
export const CONFIG_DIR = join(PROJECT_ROOT, "experiments", "config");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadWorldConfig(path: string = join(CONFIG_DIR, "world.base.json")): WorldConfig {
  return WorldConfigSchema.parse(readJson(path));
}

export function loadStreamConfig(path: string = join(CONFIG_DIR, "stream.base.json")): StreamConfig {
  return StreamConfigSchema.parse(readJson(path));
}

export function loadCurrencyConversion(path: string = join(CONFIG_DIR, "currency-conversion.json")): CurrencyConversion {
  return CurrencyConversionSchema.parse(readJson(path));
}

export function loadObservedViewBase(path: string = join(CONFIG_DIR, "observed-view.base.json")): {
  lag: number;
  window: number;
} {
  const parsed = readJson(path) as { lag: number; window: number };
  return parsed;
}

export function loadScenarioConfig(id: ScenarioId): ScenarioConfig {
  const path = join(CONFIG_DIR, "scenarios", `${id}.json`);
  return ScenarioConfigSchema.parse(readJson(path));
}
