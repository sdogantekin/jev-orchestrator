import { describe, expect, it } from "vitest";
import { checkAndIncrementGlobalDailyCap, checkVisitorRateLimit, isUpstashConfigured } from "./rateLimit.js";

// No UPSTASH_REDIS_REST_URL/TOKEN in the test environment, so these exercise the in-memory
// fallback path deliberately (never live Redis in tests). Each test uses its own IP/counter
// namespace since the fallback's state is module-level and shared across tests in this file.

describe("rateLimit (in-memory fallback)", () => {
  it("is using the in-memory fallback in this environment (no Upstash configured)", () => {
    expect(isUpstashConfigured()).toBe(false);
  });

  it("allows up to 10 requests per hour per visitor, then blocks the 11th", async () => {
    const ip = "test-ip-hourly-1";
    for (let i = 0; i < 10; i++) {
      const result = await checkVisitorRateLimit(ip);
      expect(result.allowed).toBe(true);
    }
    const eleventh = await checkVisitorRateLimit(ip);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.reason).toBe("visitor_hourly");
  });

  it("tracks different visitors independently", async () => {
    const ipA = "test-ip-independent-a";
    const ipB = "test-ip-independent-b";
    for (let i = 0; i < 10; i++) {
      expect((await checkVisitorRateLimit(ipA)).allowed).toBe(true);
    }
    expect((await checkVisitorRateLimit(ipA)).allowed).toBe(false);
    // ipB should be unaffected by ipA's usage.
    expect((await checkVisitorRateLimit(ipB)).allowed).toBe(true);
  });

  it("enforces the global daily cap (default 500) by call count, blocking the one past it", async () => {
    let lastResult;
    for (let i = 0; i < 501; i++) {
      lastResult = await checkAndIncrementGlobalDailyCap();
    }
    expect(lastResult!.allowed).toBe(false);
    expect(lastResult!.reason).toBe("global_daily");
  });
});
