import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

describe("mapWithConcurrency", () => {
  it("preserves output order regardless of completion order", async () => {
    const items = [30, 10, 20, 5, 25];
    const result = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(result).toEqual(items);
  });

  it("never runs more than `limit` tasks concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 4, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i;
    });

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];
    await mapWithConcurrency(items, 7, async (i) => {
      seen.push(i);
      return i * 2;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("handles an empty input", async () => {
    const result = await mapWithConcurrency([], 5, async (x: number) => x);
    expect(result).toEqual([]);
  });

  it("propagates a rejection from any task", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (i) => {
        if (i === 2) throw new Error("boom");
        return i;
      })
    ).rejects.toThrow("boom");
  });
});
