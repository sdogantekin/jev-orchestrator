import type { ScenarioId } from "../simulation/scenarios";

export const ROUTER_DESCRIPTIONS = {
  R0: "Naive floor: always picks the same PSP. Exists only to show there's room for any router to matter — beating this proves nothing.",
  R1: "Hand-tuned rules: an ordered rule list reflecting what a payments team would plausibly write from PSP contracts and dashboards.",
  R2: "Tuned rules: R1's rule structure, but every parameter chosen by grid search on a held-out training slice, then frozen. Intended as the strongest rule baseline; in practice the tuning picked up noise and R2 ended up level with R1, so beating either means beating a solid rule set.",
  Jev: "Jev (R3): a probabilistic decision model. Sees the exact same eligible PSPs and observed stats as every other router, nothing more.",
} as const;

export const SCENARIO_DESCRIPTIONS: Record<ScenarioId, string> = {
  stable: "Nothing is wrong — the baseline. Tests whether Jev roughly matches tuned rules when nothing is drifting, stale, or thin.",
  drift: "PSP Beta's true acceptance quietly drops 8 points mid-stream; observed data only catches up after a lag. Tests whether Jev adapts faster than static rules.",
  thin_data: "One PSP's history for a specific segment is capped at ~25 attempts. Tests whether Jev handles very little evidence better than rules.",
  cold_start: "One PSP's entire observed history is capped at ~20 attempts, as if it just launched. Same test as thin data, for a whole PSP rather than one segment.",
  conflicting_objectives: "The highest-acceptance PSP is also the most expensive, and amounts skew larger. Tests how routers handle a real accept-vs-cost trade-off.",
  eligibility_mix: "The payment-method mix shifts so hard eligibility exclusions happen more often. Tests whether a noisier eligible-candidate set changes which router wins.",
};
