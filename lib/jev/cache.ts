import { createHash } from "node:crypto";
import type { DecisionsApiRequest } from "./request.js";
import type { DecisionsApiResponse } from "./response.js";

/** Recursively sorts object keys so JSON.stringify output doesn't depend on insertion order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Section 9.7: "cache Jev answers by state hash." Hashes the whole request (model + state + questions), so a model or question-text change is a cache miss too, not just a state change. */
export function hashDecisionRequest(request: DecisionsApiRequest): string {
  const canonical = JSON.stringify(canonicalize(request));
  return createHash("sha256").update(canonical).digest("hex");
}

export interface JevCacheEntry {
  response: DecisionsApiResponse;
}

export interface JevCache {
  get(key: string): JevCacheEntry | undefined;
  set(key: string, entry: JevCacheEntry): void;
}

export function createInMemoryCache(): JevCache {
  const map = new Map<string, JevCacheEntry>();
  return {
    get: (key) => map.get(key),
    set: (key, entry) => {
      map.set(key, entry);
    },
  };
}
