import type { RouterFn } from "./types.js";

/** R0 (section 6): always PSP Alpha if eligible, otherwise the first eligible PSP. Floor, not a real competitor. */
export const naiveRouter: RouterFn = ({ eligible }) => {
  const alpha = eligible.find((p) => p.id === "alpha");
  if (alpha) return alpha.id;
  const first = eligible[0];
  if (!first) throw new Error("naiveRouter called with no eligible PSPs");
  return first.id;
};
