import { z } from "zod";
import { CURRENCIES } from "./types.js";

/** Section 5.3: fixed simulation constants for converting amounts to EUR for reporting. Not market rates. */
export const CurrencyConversionSchema = z.object(
  Object.fromEntries(CURRENCIES.map((c) => [c, z.number().positive()])) as Record<
    (typeof CURRENCIES)[number],
    z.ZodNumber
  >
);
export type CurrencyConversion = z.infer<typeof CurrencyConversionSchema>;

export function toEUR(amount: number, currency: (typeof CURRENCIES)[number], rates: CurrencyConversion): number {
  return amount * rates[currency];
}
