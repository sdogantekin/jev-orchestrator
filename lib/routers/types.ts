import type { PspConfig } from "../domain/psp.js";
import type { PspId, Transaction } from "../domain/types.js";
import type { ObservedPspStats } from "../simulation/observedView.js";

export const ROUTER_IDS = ["R0", "R1", "R2"] as const;
export type RouterId = (typeof ROUTER_IDS)[number];

/** What every router receives (section 6: "All routers receive the same eligible candidate set and the same observed view."). Only eligible PSPs have an entry. */
export interface RouterInput {
  tx: Transaction;
  eligible: PspConfig[];
  observed: Partial<Record<PspId, ObservedPspStats>>;
}

export type RouterFn = (input: RouterInput) => PspId;
