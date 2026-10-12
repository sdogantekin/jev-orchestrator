import { describe, expect, it } from "vitest";
import { JevClientError } from "./client.js";
import { withRetry } from "./retry.js";

const noSleep = async () => {};

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on a 429 and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new JevClientError("rate limited", undefined, 429);
        return "ok";
      },
      { sleepImpl: noSleep }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("retries on a 5xx", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new JevClientError("server error", undefined, 503);
        return "ok";
      },
      { sleepImpl: noSleep }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries on a network error (no status)", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new JevClientError("Jev could not be reached.");
        return "ok";
      },
      { sleepImpl: noSleep }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a 400 (not worth repeating the same request)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new JevClientError("bad request", undefined, 400);
        },
        { sleepImpl: noSleep }
      )
    ).rejects.toThrow("bad request");
    expect(calls).toBe(1);
  });

  it("does not retry a shape-validation failure (not a JevClientError with a retryable status)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("some other unrelated bug");
        },
        { sleepImpl: noSleep }
      )
    ).rejects.toThrow("some other unrelated bug");
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new JevClientError("still rate limited", undefined, 429);
        },
        { sleepImpl: noSleep, maxRetries: 2 }
      )
    ).rejects.toThrow("still rate limited");
    expect(calls).toBe(3); // initial attempt + 2 retries
  });
});
