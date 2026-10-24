# Results — Experiment 2 (high-volume data)

Run 2026-10-24, scored against `docs/hypotheses-v2.md` (committed before the run). Model
`typesafe/jev-1.13`, data richness level 2, 6 scenarios x eval seeds 1-20 x 700 test-slice
decisions. Raw results: `experiments/results/jev-v2-<scenario>.json`.

**Run health:** 84,000 live calls, 84,000 ok, 0 invalid, 0 failed, 0 fallbacks. Total cost
$5.45. Average call latency 200ms, worst 10.9s. The v1 replay found every recorded answer
(0 fallbacks). An earlier attempt the same day failed on an expired API key (every call
returned 401, nothing charged or recorded); the script now aborts in that case.

## Expected authorization rate (primary metric), %

95% CIs are paired bootstrap, 2,000 resamples. Differences are in percentage points.

| Scenario | Jev v1 | **Jev v2** | R0 | R1 | R2 | Stats ref. | Oracle | Jev - R1 | Jev - R2 |
|---|---|---|---|---|---|---|---|---|---|
| Stable | 93.48 | **94.53** | 94.29 | 94.53 | 94.29 | 94.58 | 95.00 | 0.00 [-0.02, 0.03] | +0.25 [0.22, 0.28] |
| Drift | 93.01 | **94.06** | 94.09 | 93.78 | 93.71 | 94.19 | 94.61 | +0.27 [0.24, 0.31] | +0.35 [0.31, 0.39] |
| Thin data | 93.33 | **94.14** | 94.30 | 94.53 | 94.28 | 94.24 | 95.00 | -0.39 [-0.42, -0.36] | -0.14 [-0.17, -0.11] |
| Cold start | 93.64 | **94.65** | 94.30 | 94.57 | 94.38 | 93.95 | 95.00 | +0.08 [0.06, 0.10] | +0.27 [0.24, 0.29] |
| Conflicting | 94.58 | **95.80** | 95.32 | 95.60 | 95.85 | 95.82 | 96.21 | +0.20 [0.17, 0.22] | -0.05 [-0.07, -0.03] |
| Eligibility mix | 93.34 | **94.40** | 94.26 | 94.39 | 94.58 | 94.43 | 94.87 | 0.00 [-0.02, 0.03] | -0.18 [-0.20, -0.16] |

Headroom captured by Jev, (Jev - R0) / (oracle - R0): stable 34%, drift -7%, thin data -23%,
cold start 50%, conflicting 53%, eligibility mix 23%. In Experiment 1 it was negative everywhere.

## Hypothesis verdicts

| ID | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| V2-H1 | More data helps Jev. | **Supported** | Jev v2 - Jev v1 is +0.81 to +1.22pp, CI above zero, in all 6 scenarios. |
| V2-H2 | With good data, Jev no longer loses to the rules on stable traffic. | **Supported** | Stable: Jev - R1 = 0.00 [-0.02, 0.03]. Exact tie with R1, and +0.25 above R2. |
| V2-H3 | With good data, Jev beats static rules when a PSP drifts. | **Supported** | Drift: Jev - R1 = +0.27, Jev - R2 = +0.35, both CIs above zero. |
| V2-H4 | Cold start still hurts Jev. | **Not supported** | Cold start: Jev - R1 = +0.08 [0.06, 0.10]. Jev beat both rule sets, by its widest margin over the statistics reference (+0.70). |
| V2-H5 | Jev adds nothing beyond simple statistics. | **Not supported** (one scenario) | Cold start: Jev - stats ref. = +0.70, CI above zero. In the other 5 scenarios Jev is slightly *below* the reference (-0.02 to -0.13). |

## What this means

- **Experiment 1's loss was mostly about thin data, not Jev.** With 20x more data, the same
  model gains about 1 point everywhere and goes from below "always Alpha" to level with the
  rules. Against R2 (the pre-registered baseline) it now wins 3 scenarios and loses 3, all by
  small margins (-0.18 to +0.35pp).
- **Where Jev helps:** a PSP degrading mid-stream (drift) and a new PSP with little history
  (cold start). Static rules can't react to the first. In the second, a simple formula takes
  20 attempts at face value, and Jev seems to discount them sensibly.
- **Where Jev still loses:** thin data. One segment is capped at 25 attempts, and Jev trails
  every rule router there. It handles a whole PSP with little data better than one thin
  segment inside a well-observed PSP.
- **Jev mostly equals a simple statistics formula.** It is within 0.13pp of the reference
  everywhere except cold start. So with good data, Jev behaves roughly like sensible basic
  statistics, not better, with the one cold-start exception.
- **Caveats.**
  - In drift, Jev beats the rules but only ties "always Alpha" (-0.03). This world happens
    to degrade Beta, the PSP Alpha replaces.
  - R2 still trails R1 in several scenarios (tuning noise, unchanged from Experiment 1), so
    R1 is the stronger rule baseline here.
  - Headroom is still only ~0.5pp, so every win and loss is a few tenths of a point.
  - The realized (coin-flip) authorization rates, reported for continuity, can't separate any
    of these differences: all their CIs overlap.
- **Unchanged from Experiment 1:** Jev costs money per call (~$0.000065) and adds latency (200ms
  average, 10.9s worst), where rules are free and instant. That production trade-off still
  applies.
