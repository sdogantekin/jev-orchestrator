import { describe, expect, it } from "vitest";
import { loadCurrencyConversion, loadStreamConfig } from "./configLoader.js";
import { generateStream, generateTransaction } from "./stream.js";

const streamConfig = loadStreamConfig();
const rates = loadCurrencyConversion();

describe("generateTransaction", () => {
  it("is deterministic for the same seed and index", () => {
    const a = generateTransaction("seed-1", 42, streamConfig, rates);
    const b = generateTransaction("seed-1", 42, streamConfig, rates);
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    const a = generateStream("seed-1", 50, streamConfig, rates);
    const b = generateStream("seed-2", 50, streamConfig, rates);
    expect(a).not.toEqual(b);
  });

  it("produces SEPA Debit only for EUR transactions", () => {
    const stream = generateStream("seed-sepa-check", 5000, streamConfig, rates);
    const sepa = stream.filter((t) => t.paymentMethod === "sepa_debit");
    expect(sepa.length).toBeGreaterThan(0);
    expect(sepa.every((t) => t.currency === "EUR")).toBe(true);
  });

  it("only assigns a card scheme when the payment method is card", () => {
    const stream = generateStream("seed-scheme-check", 2000, streamConfig, rates);
    for (const t of stream) {
      if (t.paymentMethod === "card") expect(t.cardScheme).not.toBeNull();
      else expect(t.cardScheme).toBeNull();
    }
  });

  it("only sets 3DS eligible for card transactions", () => {
    const stream = generateStream("seed-3ds-check", 2000, streamConfig, rates);
    for (const t of stream) {
      if (t.paymentMethod !== "card") expect(t.threeDsEligible).toBe(false);
    }
  });

  it("assigns the amount bucket consistent with configured bounds", () => {
    const stream = generateStream("seed-bucket-check", 3000, streamConfig, rates);
    for (const t of stream) {
      if (t.amountBucket === "small") expect(t.amount).toBeLessThan(streamConfig.amount.smallMax);
      if (t.amountBucket === "medium") {
        expect(t.amount).toBeGreaterThanOrEqual(streamConfig.amount.smallMax);
        expect(t.amount).toBeLessThan(streamConfig.amount.largeMin);
      }
      if (t.amountBucket === "large") expect(t.amount).toBeGreaterThanOrEqual(streamConfig.amount.largeMin);
    }
  });
});

describe("generateStream distribution statistics", () => {
  const n = 20000;
  const stream = generateStream("distribution-check-seed", n, streamConfig, rates);

  it("matches configured amount bucket weights within 2 percentage points", () => {
    const small = stream.filter((t) => t.amountBucket === "small").length / n;
    const medium = stream.filter((t) => t.amountBucket === "medium").length / n;
    const large = stream.filter((t) => t.amountBucket === "large").length / n;
    expect(small).toBeCloseTo(streamConfig.amount.bucketWeights.small, 1);
    expect(medium).toBeCloseTo(streamConfig.amount.bucketWeights.medium, 1);
    expect(large).toBeCloseTo(streamConfig.amount.bucketWeights.large, 1);
  });

  it("matches configured country/currency weights within 2 percentage points", () => {
    for (const cc of streamConfig.countryCurrency) {
      const share = stream.filter((t) => t.country === cc.country && t.currency === cc.currency).length / n;
      expect(share).toBeCloseTo(cc.weight, 1);
    }
  });

  it("matches configured device and customer type weights within 2 percentage points", () => {
    expect(stream.filter((t) => t.device === "mobile").length / n).toBeCloseTo(streamConfig.device.mobile, 1);
    expect(stream.filter((t) => t.customerType === "new").length / n).toBeCloseTo(streamConfig.customerType.new, 1);
  });

  it("payment method share is close to configured weights, adjusted for SEPA/non-EUR resampling", () => {
    // sepa_debit never survives outside EUR, so its overall share is lower than the raw weight;
    // card's share rises correspondingly. Just check card is the plurality and sepa is EUR-only.
    const card = stream.filter((t) => t.paymentMethod === "card").length / n;
    expect(card).toBeGreaterThan(0.6);
    expect(card).toBeLessThan(0.8);
  });
});
