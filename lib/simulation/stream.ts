import { toEUR, type CurrencyConversion } from "../domain/currency.js";
import type { AmountBucket, CardScheme, Transaction } from "../domain/types.js";
import { bernoulli, inverseNormalCDF, normalCDF, transactionDraw } from "./rng.js";
import type { StreamConfig } from "./streamConfig.js";
import { weightedChoice } from "./weightedChoice.js";

interface BucketBounds {
  bucket: AmountBucket;
  lo: number;
  hi: number; // Infinity for the open-ended large bucket
}

function bucketBounds(cfg: StreamConfig): BucketBounds[] {
  return [
    { bucket: "small", lo: 0, hi: cfg.amount.smallMax },
    { bucket: "medium", lo: cfg.amount.smallMax, hi: cfg.amount.largeMin },
    { bucket: "large", lo: cfg.amount.largeMin, hi: Infinity },
  ];
}

/** Sample a value within [lo, hi) from a lognormal(mu, sigma) truncated to that range. */
function truncatedLognormal(mu: number, sigma: number, lo: number, hi: number, u: number): number {
  const zLo = lo > 0 ? (Math.log(lo) - mu) / sigma : -Infinity;
  const zHi = Number.isFinite(hi) ? (Math.log(hi) - mu) / sigma : Infinity;
  const pLo = normalCDF(zLo);
  const pHi = normalCDF(zHi);
  const p = pLo + u * (pHi - pLo);
  // Clamp away from the exact 0/1 edges the inverse CDF cannot handle.
  const clampedP = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const z = inverseNormalCDF(clampedP);
  const amount = Math.exp(mu + sigma * z);
  // Guard against floating-point drift landing just outside the bucket bounds.
  const epsilon = 1e-6;
  return Math.min(Math.max(amount, lo), Number.isFinite(hi) ? hi - epsilon : amount);
}

function generateAmount(seed: string, index: number, cfg: StreamConfig): { amount: number; bucket: AmountBucket } {
  const bounds = bucketBounds(cfg);
  const bucketU = transactionDraw(seed, index, "amount_bucket");
  const bucket = weightedChoice(bucketU, [
    { value: "small" as const, weight: cfg.amount.bucketWeights.small },
    { value: "medium" as const, weight: cfg.amount.bucketWeights.medium },
    { value: "large" as const, weight: cfg.amount.bucketWeights.large },
  ]);
  const chosen = bounds.find((b) => b.bucket === bucket)!;
  const mu = Math.log(cfg.amount.medianEUR);
  const amountU = transactionDraw(seed, index, "amount_in_bucket");
  const amount = truncatedLognormal(mu, cfg.amount.sigma, chosen.lo, chosen.hi, amountU);
  return { amount, bucket };
}

export function generateTransaction(
  seed: string,
  index: number,
  cfg: StreamConfig,
  conversionRates: CurrencyConversion
): Transaction {
  const { amount, bucket } = generateAmount(seed, index, cfg);

  const countryCurrency = weightedChoice(
    transactionDraw(seed, index, "country_currency"),
    cfg.countryCurrency.map((cc) => ({ value: `${cc.country}|${cc.currency}` as const, weight: cc.weight }))
  );
  const [country, currency] = countryCurrency.split("|") as [Transaction["country"], Transaction["currency"]];

  let paymentMethod = weightedChoice(transactionDraw(seed, index, "payment_method"), [
    { value: "card" as const, weight: cfg.paymentMethod.card },
    { value: "paypal" as const, weight: cfg.paymentMethod.paypal },
    { value: "sepa_debit" as const, weight: cfg.paymentMethod.sepa_debit },
  ]);
  if (paymentMethod === "sepa_debit" && currency !== "EUR") {
    // SEPA Debit only exists for EUR; resample from card/paypal, renormalized (section 5.4).
    paymentMethod = weightedChoice(transactionDraw(seed, index, "payment_method_resample"), [
      { value: "card" as const, weight: cfg.paymentMethod.card },
      { value: "paypal" as const, weight: cfg.paymentMethod.paypal },
    ]);
  }

  let cardScheme: CardScheme | null = null;
  if (paymentMethod === "card") {
    cardScheme = weightedChoice(transactionDraw(seed, index, "card_scheme"), [
      { value: "visa" as const, weight: cfg.cardScheme.visa },
      { value: "mastercard" as const, weight: cfg.cardScheme.mastercard },
      { value: "amex" as const, weight: cfg.cardScheme.amex },
    ]);
  }

  const device = weightedChoice(transactionDraw(seed, index, "device"), [
    { value: "mobile" as const, weight: cfg.device.mobile },
    { value: "desktop" as const, weight: cfg.device.desktop },
  ]);

  const customerType = weightedChoice(transactionDraw(seed, index, "customer_type"), [
    { value: "returning" as const, weight: cfg.customerType.returning },
    { value: "new" as const, weight: cfg.customerType.new },
  ]);

  const threeDsEligible =
    paymentMethod === "card" && bernoulli(cfg.threeDsEligibleRateForCard, transactionDraw(seed, index, "three_ds_eligible"));

  return {
    index,
    amount,
    amountEUR: toEUR(amount, currency, conversionRates),
    amountBucket: bucket,
    currency,
    country,
    paymentMethod,
    cardScheme,
    device,
    customerType,
    threeDsEligible,
  };
}

export function generateStream(
  seed: string,
  count: number,
  cfg: StreamConfig,
  conversionRates: CurrencyConversion
): Transaction[] {
  const stream: Transaction[] = [];
  for (let i = 0; i < count; i++) {
    stream.push(generateTransaction(seed, i, cfg, conversionRates));
  }
  return stream;
}
