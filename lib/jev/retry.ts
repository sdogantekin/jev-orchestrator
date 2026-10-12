import { JevClientError } from "./client.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429 (rate limited) and 5xx (server-side) are worth retrying; a network/timeout error (no status) too. Anything else (400, a shape-validation failure) means retrying would just repeat the same bug. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof JevClientError)) return false;
  if (err.status === undefined) return true;
  return err.status === 429 || err.status >= 500;
}

/**
 * Retries a Jev call with exponential backoff plus jitter (section 18/docs/jev-api-notes.md:
 * TypeSafe's documented behavior on 429 is to return a Retry-After header, but since that
 * isn't primary-confirmed, this backs off generically rather than trusting a specific header).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 4, baseDelayMs = 500, sleepImpl = defaultSleep } = options;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      await sleepImpl(delay);
    }
  }
  throw lastErr;
}
