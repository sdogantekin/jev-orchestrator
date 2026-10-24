# Hypotheses — Experiment 2 (high-volume data)

Drafted 2026-10-24, before any Jev call on the v2 world. Committed before the run; the results
are reported against these, whatever the outcome. Experiment 1's hypotheses
(`docs/hypotheses.md`) and results are unchanged.

## Why there is a second experiment

After Experiment 1, a free, rules-only analysis showed:

- The observed data routers receive is very noisy: per-segment acceptance is off from the truth
  by ~7.6 points on average, more than the real differences between PSPs.
- So following the data loses to ignoring it: picking the highest observed acceptance scores
  below "always PSP Alpha".
- Jev picks the highest observed acceptance ~78% of the time, which accounts for most of its loss.

That suggests Jev's Experiment 1 loss was mostly about thin data rather than Jev itself.
Experiment 2 tests that directly.

## What changes, and what doesn't

- **Changes (only this):** observed stats come from a platform that sees 20 background
  transactions for every routed one (`experiments/config/v2/high-volume.json`). The per-segment
  error falls to ~2 points (`experiments/results/v2-design-check.json`).
- **Unchanged:** the world (PSPs, hidden effects, drift), the 6 scenarios, the transaction
  streams, the eval seeds (1-20) and test slice (300-999), Jev's model (`typesafe/jev-1.13`), data
  richness level 2, the Decision Schema, and the objective text.
- **R2 is retuned on v2 data** (same grid, same 5 tuning seeds, training slice only), since R2 means
  "rules tuned on the data available". Params: `experiments/config/v2/tuned/`.
- The headroom is still small: a perfect router beats R1 by only ~0.5 points. This experiment
  deliberately doesn't change that; a richer world would be a separate Experiment 3.

What was seen before writing this: the rules-only design check (R0, R1, R2, the simple
statistics reference, oracle). No Jev output on v2 data.

## How results are judged

- **Primary metric: expected authorization rate**, meaning the true probability that the chosen
  PSP authorizes (availability x true acceptance), averaged over the test-slice decisions of
  all 20 seeds. Differences between routers are now a few tenths of a point, which coin-flip
  results can't resolve; the expected rate removes that noise.
- **A difference counts only if its paired 95% bootstrap CI (2,000 resamples, paired by
  transaction) excludes zero.**
- Secondary, reported as in Experiment 1: realized authorization rate, net cost per authorized,
  disagreement table, invalid/failed/fallback counts, latency, cost.
- Comparators: R0, R1, R2, the **simple statistics reference** (`lib/routers/statsReference.ts`:
  segment acceptance blended with overall by sample size; a reference, not a competitor), the
  oracle ceiling, and **Jev in Experiment 1** (replayed free from recorded fixtures, same seeds).
- "Headroom captured" = (Jev - R0) / (oracle - R0).

## Hypotheses

| ID | Hypothesis | Supported if |
|---|---|---|
| V2-H1 | More data helps Jev. | Jev (v2) - Jev (v1) is positive with CI above zero in at least 5 of 6 scenarios. |
| V2-H2 | With good data, Jev no longer loses to the rules on stable traffic. | On Stable, the CI of Jev - R1 includes zero or is above it. |
| V2-H3 | With good data, Jev beats static rules when a PSP drifts. | On Drift, Jev - R1 and Jev - R2 are both positive with CI above zero. |
| V2-H4 | Cold start still hurts Jev. | On Cold start, Jev - R1 is negative with CI below zero. |
| V2-H5 | Jev adds nothing beyond simple statistics. | In no scenario is Jev - statistics reference positive with CI above zero. |

If V2-H1 fails, the "thin data" explanation of Experiment 1 is wrong, and Jev's loss has another
cause. The report has to say so.

## Run plan

- One live run: 6 scenarios x 20 seeds x 700 decisions, about 84,000 calls (estimated by the
  `--dry-run` mode of `experiments/scripts/run-jev-v2-batch.ts` before spending anything).
- Responses are recorded as fixtures (same as Experiment 1), so reruns are free.
- No changes to the world, the metric or these hypotheses after the run starts. Any bug found
  after the run is fixed, disclosed, and both the before and after numbers are reported.
