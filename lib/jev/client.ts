import type { DecisionsApiRequest } from "./request.js";
import { DecisionsApiResponseSchema, type DecisionsApiResponse } from "./response.js";

/** Confirmed in docs/jev-api-notes.md. The "alpha" in the path is OpenRouter's, not ours — re-check before the live pilot in case it has moved. */
export const DECISIONS_API_URL = "https://openrouter.ai/api/alpha/decisions";

export class JevClientError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

export interface JevClientOptions {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * The only function in this adapter that makes a network call. Never invoked in tests or CI
 * (section 15) — always injected/mocked there. Throws JevClientError on any failure
 * (unreachable, non-2xx, or a response that fails shape validation); decide.ts turns that into
 * a "failed" decision rather than letting it propagate as an unhandled rejection.
 */
export async function callJevDecisions(request: DecisionsApiRequest, options: JevClientOptions): Promise<DecisionsApiResponse> {
  const { apiKey, timeoutMs = 10_000, fetchImpl = fetch } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchImpl(DECISIONS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    throw new JevClientError("Jev could not be reached.", err);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new JevClientError(`Jev request failed with status ${res.status}.`, await safeText(res));
  }

  const json: unknown = await res.json();
  const parsed = DecisionsApiResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new JevClientError("Jev response failed shape validation.", parsed.error);
  }
  return parsed.data;
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
