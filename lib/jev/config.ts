/** Section 8.1 / 13: the pinned model, configurable, and the API key, which must stay server-side. */
export const DEFAULT_JEV_MODEL = "typesafe/jev-1.13";

export function getJevModel(): string {
  return process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;
}

/** Throws rather than returning undefined, so a missing key fails loudly and early (section 14: "Missing config"). */
export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env (never commit it).");
  }
  return key;
}
