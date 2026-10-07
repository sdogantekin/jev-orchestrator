export const CURRENCIES = ["EUR", "GBP", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const COUNTRIES = ["DE", "NL", "FR", "UK", "US"] as const;
export type Country = (typeof COUNTRIES)[number];

export const PAYMENT_METHODS = ["card", "paypal", "sepa_debit"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CARD_SCHEMES = ["visa", "mastercard", "amex"] as const;
export type CardScheme = (typeof CARD_SCHEMES)[number];

export const DEVICES = ["mobile", "desktop"] as const;
export type Device = (typeof DEVICES)[number];

export const CUSTOMER_TYPES = ["new", "returning"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const AMOUNT_BUCKETS = ["small", "medium", "large"] as const;
export type AmountBucket = (typeof AMOUNT_BUCKETS)[number];

export const PSP_IDS = ["alpha", "beta", "gamma"] as const;
export type PspId = (typeof PSP_IDS)[number];

/** One generated transaction in the stream. Immutable, fully determined by (seed, index, config). */
export interface Transaction {
  index: number;
  amount: number;
  amountEUR: number;
  amountBucket: AmountBucket;
  currency: Currency;
  country: Country;
  paymentMethod: PaymentMethod;
  cardScheme: CardScheme | null;
  device: Device;
  customerType: CustomerType;
  threeDsEligible: boolean;
}

/** The segment key used for observed-view aggregation (section 5.5). */
export interface SegmentKey {
  currency: Currency;
  country: Country;
  paymentMethod: PaymentMethod;
  amountBucket: AmountBucket;
}

export function segmentKeyOf(tx: Transaction): SegmentKey {
  return {
    currency: tx.currency,
    country: tx.country,
    paymentMethod: tx.paymentMethod,
    amountBucket: tx.amountBucket,
  };
}

export function segmentKeyEquals(a: SegmentKey, b: SegmentKey): boolean {
  return (
    a.currency === b.currency &&
    a.country === b.country &&
    a.paymentMethod === b.paymentMethod &&
    a.amountBucket === b.amountBucket
  );
}
