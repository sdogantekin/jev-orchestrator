/**
 * Deterministic hash-based draws (section 5.3 common random numbers). Every random value in the
 * simulator is derived from a string key via a non-cryptographic hash, never from a stateful
 * PRNG. The same key always produces the same value, so outcomes depend only on
 * (seed, transaction index, PSP id, step) and never on which router made the call or in what
 * order PSPs were evaluated.
 */

/** cyrb53 hash (public domain, by bryc): fast, well-distributed, not cryptographic. */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Deterministic uniform draw in [0, 1), keyed by an arbitrary string. */
export function unit(key: string): number {
  return cyrb53(key) / 9007199254740992; // 2^53, cyrb53's output range
}

export type DrawStep =
  | "availability"
  | "authorization"
  | "latency"
  | "chargeback"
  | "amount_bucket"
  | "amount_in_bucket"
  | "country_currency"
  | "payment_method"
  | "payment_method_resample"
  | "card_scheme"
  | "device"
  | "customer_type"
  | "three_ds_eligible";

/** Common-random-number draw for a (seed, transaction index, PSP, step) combination. */
export function pspDraw(seed: string, index: number, pspId: string, step: DrawStep): number {
  return unit(`${seed}|${index}|${pspId}|${step}`);
}

/** Draw for a transaction attribute, independent of any PSP and of routing. */
export function transactionDraw(seed: string, index: number, step: DrawStep): number {
  return unit(`${seed}|${index}|_tx|${step}`);
}

export function bernoulli(p: number, u: number): boolean {
  return u < p;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 approximation, max error ~1.5e-7). */
export function normalCDF(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** Standard normal inverse CDF (Acklam's rational approximation, relative error ~1.15e-9). */
export function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pLow = 0.02425;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (
      (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
    ) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}
