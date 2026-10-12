import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../simulation/configLoader.js";
import { DecisionsApiResponseSchema, type DecisionsApiResponse } from "./response.js";

/** Section 9.7: "Run the full live batch once. Commit recorded responses as fixtures so anyone can replay the experiment for free." */
export const DEFAULT_FIXTURES_DIR = join(PROJECT_ROOT, "experiments", "fixtures");

export function fixturePath(hash: string, dir: string = DEFAULT_FIXTURES_DIR): string {
  return join(dir, `${hash}.json`);
}

export function loadFixture(hash: string, dir: string = DEFAULT_FIXTURES_DIR): DecisionsApiResponse | null {
  const path = fixturePath(hash, dir);
  if (!existsSync(path)) return null;
  const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
  return DecisionsApiResponseSchema.parse(raw);
}

export function saveFixture(hash: string, response: DecisionsApiResponse, dir: string = DEFAULT_FIXTURES_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fixturePath(hash, dir), JSON.stringify(response, null, 2));
}
