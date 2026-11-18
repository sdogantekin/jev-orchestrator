# Requirements status

[`docs/requirements.md`](requirements.md) is the requirements document for this project. It was
prepared together with an AI assistant before any code was written, and it is kept here exactly
as it was committed on 2026-10-07. This file records where the project ended up against it: what
was met, what changed and why, and what was not done. Last updated 2026-11-18.

- "section N" in code comments and docs refers to the numbered sections of `requirements.md`.
- Statuses: **Met**, **Met, with a change**, **Partly**, **Not done**.

## How the build followed the document

Section 17 sets the build order, and section 19 says to stop and report at each checkpoint. The
commit history follows that order; a few commits carry their checkpoint label (C2, C3, C4), the rest are labeled by step.

| Checkpoint | What | Commits |
|---|---|---|
| Before C1 | Hypotheses and requirements committed before any code | `e11b011d8` |
| C1 | Domain model and seeded simulator | `bc9333d09` |
| C2 | R0/R1/R2 routers, R2 tuning, batch runner, results without Jev | `2f4f07ff7`, `369436924` |
| C3 | Live Jev API verified before writing the adapter | `c87df552d` |
| C4 | Adapter, then a one-seed live pilot | `54e3db156`, `cf6196b6f` |
| C5 | Probes, full 6-scenario run, data richness, sensitivity | `a3af104b3`, `a84cd4142`, `15994d421`, `b36e12506` |
| C6 | Results page and Playground | `db02dda25`, `7a72c6dda`, `697bca56d` |

Decisions made during the build that changed the plan are recorded in
[`assumptions.md`](assumptions.md), for example #8 (R2 tuning, signed off by the owner on
2026-10-07) and #11 (recorded responses not committed).

## Acceptance criteria (section 16)

| # | Criterion | Status | Evidence and notes |
|---|---|---|---|
| 1 | Hypotheses committed before the first run | Met | [`hypotheses.md`](hypotheses.md), first commit `e11b011d8` (2026-10-07), before any simulator code |
| 2 | Simulator separates world from observed, with background history independent of router choices | Met | `lib/domain/world.ts`, `lib/simulation/observedView.ts`; assumptions #4 |
| 3 | Six scenario types, reproducible from a seed | Met | `experiments/config/scenarios/`, `lib/simulation/scenarios.ts` and its test |
| 4 | Draws use common random numbers | Met | `lib/simulation/rng.ts`, `outcome.ts`; tests in `rng.test.ts`, `outcome.test.ts`, `evaluate.test.ts` |
| 5 | R0 to R3 run on identical streams | Met | `lib/experiments/evaluate.ts`, `jevBatch.ts`; comparisons paired by seed and transaction |
| 6 | R2 tuned on the training slice, tested on the test slice only | Met, with a change | Tuned on 5 pooled tuning seeds instead of one stream, after the single-stream version overfit (assumptions #8). Never tuned on the test slice. |
| 7 | Probe tests run and reported | Met | `experiments/results/probes.json`, `calibration.json`; Results page. Calibration is derived from the main run, with no extra calls. |
| 8 | Batch results include confidence intervals with seed counts | Met | `experiments/results/*.json` (bootstrap 95% CIs); Experiment 2 adds seed-level intervals (`v2-seed-level.json`) |
| 9 | Disagreements table with the fixed outcome definition | Met | `lib/experiments/jevComparison.ts`; Results page |
| 10 | Data richness comparison | Met | `data-richness-stable.json`, `data-richness-drift.json` (levels 1 and 3 run live, level 2 reused from the main run) |
| 11 | Sensitivity check | Met | `sensitivity.json`: 9 variants, 5 seeds, stable scenario only, as the document specified |
| 12 | Recorded Jev responses committed, so the experiment replays for free | **Not done** | They are not in the repo: about 256,000 small files (roughly 1.2 GB) for the two published experiments (assumptions #11). The committed result files and the Playground's recorded examples (`preset-examples.json`) hold what the page and the report need. Rule-only scripts rerun for free; replaying Jev's answers would mean paying for the calls again. |
| 13 | Playground shows rules and Jev side by side, with probabilities | Met | `components/PlaygroundClient.tsx` |
| 14 | Disagreements highlighted, simulation mode labeled | Met, with a change | The redesign shows a "they disagree" callout and the modes "Replay · free" and "Your numbers · live AI", instead of the document's "Simulating from…" labels |
| 15 | Raw request, raw response and Decision Schema visible | Met | Technical-details panels in the Playground, the same in both modes |
| 16 | Results view with seeds and model version | Met | `app/results/page.tsx` |
| 17 | Visitor limits, daily cap and key spending limit in place | **Partly** | Per-visitor limits (10 per hour, 30 per day) and a global daily cap (counted in calls, default 500 per day) are implemented and tested (`lib/rateLimit.ts`). Production currently runs on the in-memory fallback because Upstash is not configured yet, so counts are not shared across server instances. The spending limit is an OpenRouter account setting and is not visible in the repo. |
| 18 | API key never reaches the browser | Met | Read only on the server (`app/api/decision/route.ts`, `lib/jev/config.ts`) and never returned in a response |
| 19 | Recorded presets work when live calls are paused | Met | `experiments/results/preset-examples.json`; the preset mode needs no API key |
| 20 | No real PSP integration, no way to enter real payment data | Met | All PSPs are simulated; inputs are validated against enums and ranges (`lib/playground/schema.ts`) |
| 21 | README states simulation-only, lists limitations, explains how to run | Met | [`README.md`](../README.md) |
| 22 | Unit tests cover the deterministic logic | Met | 200 tests in 29 files, no network access (`npm test`) |

## Verify before coding (section 18)

All eight items (request format, response shape, pricing, rate limits, context window,
determinism, model availability, terms of use) were answered against the live docs on 2026-10-11
and recorded in [`jev-api-notes.md`](jev-api-notes.md). Two findings mattered: Jev's output is
not fully deterministic, and a suspected ban on publishing benchmarks turned out to apply only to
a different OpenRouter program. No assumption in the document had to change.

## Testing (section 15)

| Item | Status | Where |
|---|---|---|
| Unit tests for the deterministic logic | Met | `lib/**/*.test.ts` |
| Contract test: Jev's state has the context and eligible PSPs only, and no world values or scenario names | Met | `lib/jev/state.test.ts` |
| Determinism and common-random-number tests | Met | `rng.test.ts`, `outcome.test.ts`, `evaluate.test.ts` |
| Metrics and confidence intervals against hand-computed examples | Met | `metrics.test.ts`, `jevComparison.test.ts` |
| Tests never call the live Jev API | Met | Mocks and recorded data only. There is no GitHub Actions workflow yet; tests run with `npm test`. |
| UI tests | **Not done** | The 200 tests cover the logic, not the interface |
| Optional live test behind `RUN_LIVE_JEV_TESTS` | Not done | Optional in the document |

## Other differences from the document

- **Live-result caching (section 10.3).** Not in production. The Playground's custom mode uses a
  per-request cache. The recorded-response store is switched off there, because the hosting file
  system is read-only and those recordings belong to the experiment.
- **Turnstile (section 10.3).** Optional; not built.
- **Error messages (section 14).** Five of the seven use the document's wording: Jev unreachable,
  invalid choice, visitor limit, daily cap and missing configuration. "No eligible PSP" was
  reworded in the redesign. "Simulation error" has no equivalent, since the simulated outcome is a
  local draw that cannot fail.
- **State-hash caching (section 9.7)** hardly ever hits, because the state includes exact amounts
  (assumptions #11).
- **Medium post (section 11).** Drafted; not yet published.

## Beyond the original scope

- **A diagnosis of Experiment 1** ([`EXPERIMENT.md`](../EXPERIMENT.md) section 10,
  `v1-diagnosis.json`): Jev lost even to "always pick Alpha" because the observed data was noisier
  than the real differences between PSPs.
- **Experiment 2**, pre-registered in [`hypotheses-v2.md`](hypotheses-v2.md): the same world with
  20 times more observed data, scored in [`results-v2.md`](results-v2.md).

## What the document did not anticipate

- **How noisy the observed data would be.** With the default window, a PSP's per-segment rate came
  from a median of 8 past attempts. The sensitivity check varied lag and window but not data
  volume; Experiment 2 did.
- **How little room there is to win.** A router that knows the true probabilities beats the
  hand-tuned rules by only about half a point, so the original baselines could barely separate the
  routers. Scoring by true approval probability (without coin-flip luck) fixed this for
  Experiment 2.
- **Tuning noise.** Pooling 5 tuning seeds removed the large overfit, but R2 still isn't reliably
  better than R1 (`EXPERIMENT.md` section 4.4).

## Open items

- Configure Upstash for production rate limiting (criterion 17).
- UI tests and a CI workflow.
- Five "high" `npm audit` advisories in test tooling (vitest's dependencies: vite, picomatch,
  tinyglobby, fdir). They affect development only, and no patched release exists yet. Production
  dependencies audit clean (`npm audit --omit=dev`).
