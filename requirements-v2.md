# Payment Decision Lab: Requirements (final draft)

## 0. Decisions Locked In

These were agreed before implementation. The coding agent must not change them without asking.

| Topic | Decision |
|---|---|
| Better outcome (per transaction) | An authorized payment beats a declined one. If both have the same result, the lower net cost wins. Equal means tie. |
| Headline metric | Authorization rate. Secondary: net cost per authorized transaction. |
| v1 scope | PSP selection only. Retry, 3DS decision, fallback cascades and Decision Memory are out of v1. |
| Scale | 1,000 transactions per scenario stream. 20 seeds for every router, Jev included. Sensitivity runs are the one exception (section 9.2). |
| Stream split | Transactions 0 to 299: training slice. Transactions 300 to 999: test slice. Drift starts at transaction 600. |
| Hosting | Vercel plus Upstash Redis (rate limit and daily cap counters). |
| Jev model | `typesafe/jev-1.13`, pinned, configurable via `JEV_MODEL`. |

---

## 1. Purpose

Payment Decision Lab is a simulation-only experiment. It tests one question:

> Can Jev, a probabilistic decision model, be a strong alternative to rule-based decision making in payment orchestration?

The project has three deliverables that share one codebase:

1. **The experiment:** a seeded simulator and a set of routers (rules and Jev) that run on identical transaction streams.
2. **A public web page:** a playground where visitors try one decision and see rules and Jev side by side, plus a results view with the precomputed experiment findings.
3. **A Medium post:** the main product. It carries the verdict: where Jev could replace rules, where it cannot, and what it would take in a real platform.

The app is a way to get an honest answer. It is not a demo of a payment product.

### Where the question comes from

The idea started from a public claim that Jev is weak at content generation like typical LLMs but very good at decisions based on a given data set. This project tests the second half of that claim in a payments setting. The claim is a hypothesis, not evidence. The README and post must say "claimed by X, tested here".

---

## 2. Safety Boundary (non-negotiable)

- The app never processes, authorizes, captures, refunds, routes or executes a real payment.
- It never connects to a real PSP, merchant account, card network, bank or acquirer.
- PSPs are simulated (`PSP Alpha`, `PSP Beta`, `PSP Gamma`). Nothing may imply a live integration.
- No real PAN, CVV, token, bank account, cardholder data, customer PII or production transaction data is accepted or stored.
- All results, fees, latency, retries, declines and chargebacks come from the simulator.

---

## 3. Hypotheses (commit before the first run)

Commit these to `docs/hypotheses.md` with a date before the first experiment run. The post reports results against them, whatever the outcome.

| ID | Hypothesis |
|---|---|
| H1 | Jev responds correctly to the data it is given: when one PSP's metric improves and everything else is fixed, its probability for that PSP rises sensibly. |
| H2 | On stable traffic, Jev roughly matches a well-tuned rule set. |
| H3 | When rules go stale (a PSP degrades mid-stream) or data is thin (cold start, rare segments), Jev does better than static rules. |
| H4 | Jev loses to rules on decision latency, cost per decision, determinism and auditability. |
| H5 | Jev's output is mostly but not perfectly consistent: repeated calls and harmless input changes (PSP order, field order) sometimes change the choice. |

The most likely honest result is "competitive where rules are stale or data is thin, not better than a tuned rule elsewhere". That is a useful finding, and the project should be comfortable reporting it.

---

## 4. Scope

### In v1

- One decision: choose the PSP for a first payment attempt.
- Simulator with world vs observed views and six scenario types.
- Routers R0 to R3.
- Probe tests, batch experiment, data richness comparison (section 9.5).
- Playground and Results page, Medium post.

### Out of v1 (design must not block them)

| Decision | Later |
|---|---|
| Retry or no retry, and which PSP to retry on | Next |
| 3DS or frictionless | Later |
| Fallback cascade ordering | Later |
| Decision Memory as an application-level store | Later |
| Bandit and general LLM competitors | Stretch |
| Animated decision flow | Late polish |

If time is short, ship PSP selection and say in the post that other decisions were not tested.

---

## 5. Simulator Design

The simulator is the ground truth. With no real PSPs, whoever designs the simulator decides what is learnable, so this is the biggest threat to the validity of the findings.

### 5.1 World vs observed

- **World:** the true success probabilities the simulator uses, at segment level, including drift. No router sees this.
- **Observed:** what routers receive. It is partial, noisy and slightly stale. Rules and Jev receive the identical observed view.

If outcomes were drawn from the numbers the routers see, a lookup would be optimal by construction and Jev could only tie or lose.

### 5.2 Base world (default numbers)

All values live in versioned config files, not in code.

| Field | PSP Alpha | PSP Beta | PSP Gamma |
|---|---|---|---|
| Role | Generalist | EU specialist | Cheap and fast |
| Supported currencies | EUR, GBP, USD | EUR, GBP, USD | EUR, GBP, USD |
| Supported payment methods | card, PayPal | card, PayPal, SEPA Debit | card, SEPA Debit |
| Base acceptance rate | 0.945 | 0.930 | 0.920 |
| Transaction cost % | 1.3 | 1.1 | 0.9 |
| Fixed fee | 0.25 | 0.20 | 0.15 |
| Retry success rate | 0.31 | 0.38 | 0.42 |
| Chargeback rate | 0.0018 | 0.0021 | 0.0015 |
| Latency (ms, central) | 420 | 290 | 250 |
| Availability rate | 0.999 | 0.998 | 0.9995 |

Hidden segment modifiers (added to the base acceptance rate, world only):

| PSP | Modifier |
|---|---|
| Beta | +0.045 for EUR, card, country in DE or NL |
| Beta | -0.050 for USD |
| Beta | -0.020 for new customer on mobile |
| Gamma | +0.030 for large amount with 3DS eligible |
| Gamma | -0.020 for small amount |
| Alpha | none |

Notes:
- The "new customer on mobile" effect is not part of the observed segment key (section 5.5) on purpose. Seeing it requires using the transaction context, not just the summary.
- SEPA Debit only appears with EUR transactions.
- Retry success rate and chargeback rate are world values with no modifiers in v1.
- Latency in the simulation is the central value plus bounded random variation (plus or minus 20 percent, uniform).

### 5.3 Simulation rules

- Availability, authorization, latency and chargeback outcomes are drawn from world probabilities.
- **Common random numbers:** each draw is keyed by `(seed, transaction index, PSP id, step)` using a hash-based generator, where step is availability, authorization, latency or chargeback. A draw therefore does not depend on which router picked the PSP. If two routers choose the same PSP for a transaction, they get the identical outcome. Differences between routers come only from routing choices.
- Same seed + same config + same stream = same outcome.
- An unavailable PSP counts as not authorized (no fee).
- Fees are charged only on authorized payments: `fee = amount x transaction_cost_percent + fixed_fee` (configurable assumption).
- Chargebacks are drawn only for authorized payments. Chargeback loss = transaction amount + 15 (configurable fixed chargeback fee).
- Amounts are converted to EUR for reporting with fixed simulation constants in config (EUR 1.00, GBP 1.17, USD 0.93). These are not market rates.
- No network calls to any PSP, ever.

### 5.4 Transaction stream

Generated from the seed. Defaults, all in config:

| Attribute | Distribution |
|---|---|
| Amount | Log-normal with median 60. Buckets: small below 25, medium 25 to 499.99, large 500 and above. Roughly 25% small, 60% medium, 15% large. |
| Country and currency | DE 30% (EUR), NL 10% (EUR), FR 10% (EUR), UK 20% (GBP), US 30% (USD) |
| Payment method | card 70%, PayPal 20%, SEPA Debit 10% (SEPA only for EUR countries, otherwise resampled) |
| Card scheme | visa 55%, mastercard 40%, amex 5% (only for card) |
| Device | mobile 60%, desktop 40% |
| Customer type | returning 55%, new 45% |
| 3DS eligible | true for 70% of card transactions, false otherwise |

Scenario configs can override these (for example the conflicting objectives scenario skews amounts).

### 5.5 Observed view

The observed view is computed from a **background history** that is independent of router choices. This keeps all routers on the same data, and no router is penalized for not exploring. (Exploration is therefore not tested. See limitations.)

- At transaction `t`, observed stats for each PSP are computed from background attempts in the window `[t - lag - window, t - lag]`, with defaults `lag = 50` and `window = 150` transactions.
- Background attempts are generated from the world probabilities, so observed values carry natural sampling noise.
- Observed stats include **overall** values per PSP and **segment** values for the current transaction's segment key `(currency, country, payment_method, amount_bucket)`, each with a sample size.
- Fees, fixed fees and supported lists come from config and are exact (not noisy).
- Lag and window are config values and are part of the sensitivity check.

### 5.6 Scenario types

| Scenario | World / observed changes from base |
|---|---|
| Stable | Base world. |
| Drift | At transaction 600, PSP Beta's acceptance drops by 0.08 in all segments. Observed view reflects it only after the lag. |
| Thin data | Base world. Beta's observed EUR/DE/card segment is limited to about 25 background attempts. |
| Cold start | PSP Gamma is new: observed history limited to 20 attempts overall. Its true rates are the base values. |
| Conflicting objectives | Alpha: acceptance 0.955, cost 2.0%, fixed 0.30. Beta: 0.945, 1.1%, 0.20. Gamma: 0.935, 0.9%, 0.15. Stream skewed to 40% small, 30% medium, 30% large. |
| Eligibility mix | Base world. Stream has 40% PayPal and SEPA Debit, so exclusions happen often. |

Rules for all scenarios:
- Transactions with exactly one eligible PSP are routed deterministically, excluded from router comparison metrics, and reported as a separate count.
- Transactions with zero eligible PSPs are counted and excluded.

### 5.7 Editable inputs and which numbers drive the outcome

**Visitors can edit (playground only)**

Transaction:

| Field | Options |
|---|---|
| Amount | positive number, server-side max |
| Currency | EUR, GBP, USD |
| Country | enum |
| Payment method | card, PayPal, SEPA Debit |
| Card scheme | visa, mastercard, amex (only when method is card) |
| Device | desktop, mobile |
| Customer type | new, returning |
| 3DS eligible | yes / no |

Code derives the amount bucket, expected fee per PSP and other helper fields. These are not editable.

PSP (three PSPs):

| Field | Note |
|---|---|
| Enabled | hard eligibility |
| Supported currencies | hard eligibility |
| Supported payment methods | hard eligibility |
| Transaction cost % | variable fee |
| Fixed fee | per transaction |
| Acceptance rate | observed |
| Retry success rate | observed |
| Chargeback rate | observed |
| Latency (ms) | observed |
| Availability rate | observed |
| Sample size | attempts behind the observed rates |

All values are validated on the server: rates between 0 and 1, fees and latency within fixed ranges, enums limited to allowed values.

**Visitors cannot edit**

- World settings (hidden segment effects, drift). They live only in preset scenario configs.
- Experiment settings (seed, stream size, scenario, router selection). They live in config files and are used only by the batch runner.

Reason: if visitors could change the hidden world, they could build a world where Jev looks great or terrible, and the results page would lose its meaning.

**Which numbers drive the simulated outcome**

| Mode | Outcome probability comes from |
|---|---|
| Playground, custom inputs | The observed numbers the visitor edited. |
| Playground, preset scenario | The preset's world config, including hidden segment effects. The page says so. |
| Batch experiment and Results page | Always the world config. Routers only see the observed view. |

The playground shows a visible label for the active mode ("Simulating from your inputs" or "Simulating from preset world: <name>").

---

## 6. Routers

All routers receive the same eligible candidate set and the same observed view.

| Router | Description |
|---|---|
| R0 Naive | Always PSP Alpha (if eligible, otherwise the first eligible). Floor, not a real competitor. |
| R1 Hand-tuned rules | The ordered rule list below. First match wins. |
| R2 Tuned rules | Same rule structure as R1, with parameters tuned on the training slice, then frozen. |
| R3 Jev | Jev selects the PSP from the same observed view. |

### 6.1 R1 rule list

The list reflects what a payments team would write from PSP contracts and dashboards. It knows general PSP strengths, not the hidden effect sizes.

1. Eligibility filter (code). Remove ineligible PSPs.
2. If currency is EUR, payment method is card, and country is DE, NL or FR: prefer PSP Beta.
3. If currency is USD: prefer PSP Alpha.
4. If amount bucket is large: prefer the eligible PSP with the highest observed acceptance rate.
5. If amount bucket is small: prefer the eligible PSP with the lowest fixed fee.
6. Otherwise: prefer PSP Alpha.
7. **Safety fallback:** if the preferred PSP has observed availability below 0.99 or observed acceptance below 0.88, use the eligible PSP with the highest observed acceptance instead.
8. If the preferred PSP is not in the eligible set, use the eligible PSP with the highest observed acceptance.

### 6.2 R2 tuning

- Parameters to tune: preferred PSP per rule (2, 3, 6), the large and small bucket thresholds, the safety fallback thresholds.
- Method: grid search on the training slice (transactions 0 to 299), maximizing authorization rate, ties broken by lower net cost.
- Tune per scenario, on a stream from the same scenario with a separate tuning seed. Never tune on the test slice.
- Save tuned parameters in config files so runs are reproducible.

Beating R0 proves nothing. The claim only means something against R2. A single weighted-score formula is not used as the baseline, since real orchestration is rules, splits and cascades.

Optional stretch routers, only after the main results exist:
- A bandit (epsilon-greedy or Thompson sampling).
- A general-purpose LLM given the same state and question.

---

## 7. Eligibility and Hard Rules

Hard constraints stay in code and run before any router.

- PSP disabled: exclude.
- Currency unsupported: exclude.
- Payment method unsupported: exclude.

The UI and results show excluded PSPs with the reason. Zero eligible: stop with a clear message. Exactly one eligible: route deterministically and skip Jev.

---

## 8. Jev Decision Contract

### 8.1 Access

- Provider: OpenRouter. Model: `typesafe/jev-1.13`, pinned. Never switch versions silently.
- The documented request carries `model`, `state` and `questions`, and returns typed answers with probabilities.
- Do not hardcode pricing in application logic.
- Verify the current API details before coding (section 18).

### 8.2 State

Contains only what the routing question needs:

- transaction context (amount, currency, country, payment method, card scheme, device, customer type, 3DS eligibility, amount bucket)
- eligible PSPs only, with observed metrics and sample sizes
- derived fields computed in code (for example expected fee per PSP)
- routing objective in plain words

Metric meanings are defined explicitly in the request. Jev does not know what `acceptance_rate` means in payments unless told.

Jev state must not contain: world values, scenario names, router names, or anything that reveals the experiment design.

### 8.3 Decision Schema

The decision is defined by an explicit schema generated by code: decision ID and version, name, type (`choice`), question, metric definitions, eligible option IDs with descriptions, and objective. The request to Jev is derived from this schema, not from hand-written text scattered across the code. The schema is shown in the UI.

### 8.4 Question

One `choice` question generated from the currently eligible PSPs (never hardcoded to three IDs).

### 8.5 Response handling

1. Validate the response shape.
2. Confirm the choice is in the eligible set.
3. Keep the full probability distribution.
4. Show confidence only if the API returns it. Do not present probabilities as calibrated.
5. If the response is invalid or the call fails, do not invent a decision. Record it as an invalid or failed run. A visible deterministic fallback (R1) may be used, and the run is labeled as a fallback and counted separately in metrics.
6. Never parse prose to get a route.

### 8.6 Data richness levels

| Level | What Jev gets |
|---|---|
| 1 | Overall observed PSP stats only |
| 2 | Level 1 plus observed stats for the transaction's segment with sample sizes (default for all main results) |
| 3 | Level 2 plus the last 20 observed outcomes in the same segment per PSP |

---

## 9. Experiments

### 9.1 Outcome definitions

Define once, keep fixed.

- **Authorized:** PSP available and authorization draw succeeded.
- **Net cost of a transaction:** fee (if authorized) plus chargeback loss (if a chargeback occurred), in EUR.
- **Better outcome on a disagreement:** compare the two routers' results for the same transaction. Authorized beats not authorized. If both have the same authorization result, the lower net cost wins. Otherwise tie.
- **Headline metric:** authorization rate on the test slice.
- **Secondary metric:** net cost per authorized transaction.

### 9.2 Scale and split

- 1,000 transactions per stream. Training slice: 0 to 299. Test slice: 300 to 999.
- All routers (R0, R1, R2, R3 Jev): the same 20 seeds per scenario. Every comparison is paired by seed and transaction index.
- Jev runs only on the test slice (700 decisions per seed).
- Sensitivity runs (section 9.6) use 5 seeds on the Stable scenario only, because every world variant multiplies the number of Jev calls. Report them as a robustness check and say they use fewer seeds.
- Expected Jev call volume before caching:

| Block | Calls |
|---|---|
| Main comparison: 20 seeds x 700 x 6 scenarios | 84,000 |
| Data richness: levels 1 and 3, Stable and Drift, 20 seeds x 700 x 2 levels x 2 scenarios | 56,000 |
| Sensitivity: about 10 variants x 5 seeds x 700, Stable only | 35,000 |
| Probes | about 5,000 |
| **Total** | **about 180,000** |

- At the quoted price (about USD 0.04 per million input tokens) and an estimated 1,500 tokens per call, this is roughly USD 11. Measure the real state size in the pilot (C4) and recompute. Run time and rate limits are the real constraint, so the runner needs parallel requests (section 19.3).

### 9.3 Probe tests (single decisions)

| Probe | What it checks |
|---|---|
| Responsiveness | Raise one PSP's acceptance in steps, hold the rest fixed. Its probability should rise smoothly. |
| Trade-off | Small amounts should lean to the cheaper PSP, large amounts to the higher-acceptance PSP. |
| Irrelevance | Shuffle PSP order, rename PSP display names, reorder fields, add an unrelated field. The choice should not move. |
| Repeatability | Same state, 20 repeated calls. How often does the choice change? |
| Calibration | When Jev says 70% for a PSP, how often is that PSP the better one in the simulation? |

### 9.4 Batch comparison

Per router and scenario, report:

- authorization rate
- net cost per authorized transaction
- average simulated latency
- invalid, failed and fallback decision rate (Jev)
- decision latency added (model call vs rule evaluation)
- cost per decision vs fee savings (does Jev pay for itself?)

The key table:

- **Disagreement rate** between Jev and R2.
- **On disagreements only:** wins, losses and ties for Jev vs R2, using the outcome definition in 9.1. This table is the real result.
- Jev's probability spread: does it hold back on ambiguous cases, or is it equally confident everywhere?

### 9.5 Data richness comparison

Run levels 1, 2 and 3 on the Stable and Drift scenarios with the same 20 seeds. Report whether richer data changes decisions or outcomes. If level 2 matches level 3, summaries are enough and feeding raw history is wasted cost.

### 9.6 Metric defensibility rules

- Report results over several seeds with confidence intervals (bootstrap over transactions, paired by transaction index). A single run is an anecdote.
- Show the number of seeds and transactions next to every rate.
- Do not call a difference a win if it is within the confidence interval.
- State that the simulator is synthetic. Results show behavior under this world design, not real-world performance.
- **Sensitivity check:** repeat the main comparison with changed world design (segment effect sizes halved and doubled, drift size 0.04 and 0.12, lag 25 and 100, window 75 and 300, chargeback loss assumption changed). If the conclusion flips under small changes, say so.
- Tune R2 only on the training slice.
- Do not change the outcome definition after seeing results.
- Report Jev fallback and invalid responses, not just clean results.
- Sensitivity runs use fewer seeds than the main results (section 9.2). Do not mix them into the main tables.

### 9.7 Cost control for batch runs

- Cache Jev answers by state hash. Many transactions collapse to the same segment and amount bucket.
- Run the full live batch once. Commit recorded responses as fixtures so anyone can replay the experiment for free.
- Log token and cost usage from the API response when returned.
- Run a small pilot (one scenario, one seed) before the full batch to check cost and fix bugs.

---

## 10. Web Page

One public page, two modes.

### 10.1 Playground

- Visitor sets one transaction and PSP stats (or picks a preset scenario).
- The page shows the eligibility result, the R1 and R2 choices, the Jev choice with probabilities, and the simulated outcome, side by side.
- **Disagreement highlight:** when Jev and the rules differ, make it the visual focus.
- Show the exact sanitized request and the exact structured response, syntax-highlighted and copyable.
- Show the Decision Schema used to build the request.
- Simple stepper for the flow (transaction, rules, Jev, route, simulated PSP, result). Animation is optional late polish.
- Show the active simulation mode label (section 5.7).
- Persistent banner: simulation only, no real payments.

### 10.2 Results

- Precomputed experiment findings as static charts and tables: agreement, disagreements and who won, cost and latency per decision, consistency, probe results, data richness comparison, sensitivity check.
- Each chart links to the hypothesis it tests.
- Shows the seeds, scenario configs and model version used.
- This is the page the Medium post links to.

### 10.3 Public hosting and cost control

- Hosting: Vercel, with Upstash Redis for counters.
- Per-visitor limit: about 10 live runs per hour and 30 per day per IP. Beyond that, fall back to recorded presets.
- Global daily cap, counted from usage data returned by OpenRouter (or call count if simpler). When hit, show: "Demo paused for today, recorded scenarios still work."
- Backstop: set a spending limit on the OpenRouter key itself.
- Preset scenarios serve recorded responses (free, instant, reliable).
- Cache live results by state hash.
- The server builds Jev state only from validated fields (enums and number ranges). Never pass visitor free text to Jev, so the page cannot be used as a free LLM proxy.
- Optional: Cloudflare Turnstile on the live-run button if abuse appears.
- Set the daily cap from the real per-call price on the OpenRouter model page, checked at build time.

---

## 11. Medium Post Plan

Working title idea: "Can a decision model replace my payment routing rules? I tested Jev."

1. **Why:** the claim about Jev, and the payments angle (rule engines are how orchestration works today and where they hurt).
2. **What I tested:** the five hypotheses, written before running.
3. **How the test works:** simulated PSPs, world vs observed, the router lineup. Short, with a link to the repo.
4. **Results:** probe tests first, then batch results by scenario, then the disagreements table.
5. **What Jev did well and where it failed:** with examples from the playground.
6. **Cost, latency and auditability:** the production reality check.
7. **What it would take in a real platform:** hard rules in code, fallbacks, monitoring, logging for audit.
8. **Limits of this study:** synthetic data, one decision type, one model version, no exploration.
9. **Link to the page and repo.**

The post is written after the results exist. Sections 1, 2, 3 and 8 can be drafted early.

---

## 12. Architecture

Keep a clear separation between:

1. UI
2. Domain models (transaction, PSP, world, observed view)
3. Deterministic rules (eligibility, fees, rule routers)
4. Jev adapter (request building, response validation, caching)
5. Simulation and experiment runner (seeded, runnable from the command line)

The experiment runner must work without the UI. Batches run as scripts and write results to files that the Results page reads.

Suggested stack: Next.js, TypeScript, React, Tailwind, Zod for runtime validation, Vitest for tests. A small animation library is optional. The coding agent may change the stack if the separation above is kept.

Suggested structure:

```text
app/
  page.tsx                  playground
  results/page.tsx          precomputed findings
  api/decision/route.ts     server-side Jev call with limits
components/
lib/
  domain/                   transaction, psp, world, observed, eligibility
  routers/                  naive, handTuned, tuned, jev
  jev/                      client, request, response, schema, cache
  simulation/               simulator, scenarios, seeds, stream
  experiments/              probes, batch runner, metrics
experiments/
  config/                   world, scenario, stream and tuned-rule configs (versioned)
  fixtures/                 recorded Jev responses
  results/                  run outputs used by the Results page
docs/
  hypotheses.md
README.md
requirements.md
.env.example
LICENSE
```

---

## 13. Secrets and Security

- `OPENROUTER_API_KEY` exists only server-side. Never in browser JS, HTML, props, client env vars, URLs, logs or the raw-request view.
- `JEV_MODEL` is optional config, default `typesafe/jev-1.13`.
- `.env` is git-ignored. `.env.example` has placeholders only.
- Validate every input on the server. Reject anything outside the allowed enums and ranges.
- Rate limits and daily cap as in section 10.3.

---

## 14. Error States

| Case | Message |
|---|---|
| Jev unreachable | Jev could not be reached. No AI routing decision was made. |
| Invalid Jev choice | Jev returned a decision outside the eligible PSP set. The route was rejected by validation. |
| No eligible PSP | No eligible simulated PSP is available for this transaction. |
| Simulation error | The simulated payment could not complete. No real payment was attempted. |
| Daily cap reached | Demo paused for today, recorded scenarios still work. |
| Visitor limit reached | You reached the live run limit. Recorded scenarios still work. |
| Missing config | A clear configuration error that does not reveal secrets. |

---

## 15. Testing

- Unit tests: eligibility, fee math, simulator, common random numbers, seeded determinism, scenario configs, stream generator, observed view (lag and window), rule routers, R2 tuning, Jev request building, Jev response validation, caching, rate limiting.
- Contract test: for a fixed transaction and PSP fixture, the Jev state has the transaction context, only eligible PSPs, metric definitions, objective and a typed `choice` question, and contains no world values or scenario names.
- Determinism test: same seed + same config + same stream gives the same outcomes for all non-Jev routers, and the same results for Jev when replaying recorded fixtures.
- Common random numbers test: two routers choosing the same PSP for the same transaction get identical outcomes.
- Experiment tests: metrics and confidence interval code checked against small hand-computed examples.
- UI tests: editing inputs updates state, excluded PSPs are marked, disagreement highlight appears, mode label is correct, errors are readable.
- CI never calls live Jev. Mock the adapter. An optional live test runs only when `RUN_LIVE_JEV_TESTS=true` and a key exists.

---

## 16. Acceptance Criteria

**Experiment**
- [ ] Hypotheses are committed before the first run.
- [ ] Simulator separates world from observed, with a background history independent of router choices.
- [ ] All six scenario types exist and are reproducible from a seed.
- [ ] Draws use common random numbers.
- [ ] R0 to R3 run on identical streams.
- [ ] R2 is tuned on the training slice and tested on the test slice only.
- [ ] Probe tests run and are reported.
- [ ] Batch results include confidence intervals, with seed counts shown.
- [ ] The disagreements table is produced using the fixed outcome definition.
- [ ] Data richness comparison is reported.
- [ ] A sensitivity check is reported.
- [ ] Recorded Jev fixtures are committed so the experiment replays for free.

**Page**
- [ ] Playground shows rules and Jev side by side with probabilities.
- [ ] Disagreements are highlighted and the simulation mode is labeled.
- [ ] Raw request, raw response and Decision Schema are visible.
- [ ] Results view shows the precomputed findings with seeds and model version.
- [ ] Visitor limits, daily cap and key spending limit are in place.
- [ ] API key never reaches the browser.
- [ ] Recorded presets work when live calls are paused.

**Project**
- [ ] No real PSP integration and no way to enter real payment data.
- [ ] README states simulation-only, lists limitations, explains how to run locally.
- [ ] Unit tests cover the deterministic logic.

---

## 17. Build Order

1. **Domain and simulator:** transaction, PSP, world vs observed, eligibility, fees, seeded simulator with common random numbers, stream generator, scenario configs.
2. **Rule routers and runner:** R0, R1, R2 with tuning, batch runner and metrics. Run batches with no AI.
3. **Jev adapter:** schema, request building, response validation, caching, recorded fixtures, mocks.
4. **Pilot, then probes and live batch:** one scenario and one seed first, then probes, then the full batch. Commit fixtures and results.
5. **Review the results** before building the page around them.
6. **Page:** playground, results view, hosting controls.
7. **Post:** write with real numbers. Publish the page and the post together.
8. **Later:** retry decision, bandit or general LLM comparison, animation, Decision Memory.

---

## 18. Verify Before Coding

Check these against the live docs and the OpenRouter model page before writing the adapter. Record the answers in `docs/jev-api-notes.md`.

- [ ] Exact request format of the Decisions API (`model`, `state`, `questions`) and the `choice` question shape.
- [ ] Exact response shape: choice field, probabilities, and whether a confidence value is returned.
- [ ] Current price per call or per token (input and output), and a realistic cost for about 180,000 calls (section 9.2).
- [ ] Rate limits and timeouts on OpenRouter for this model.
- [ ] Context window and any state size limits.
- [ ] Whether responses are deterministic for repeated identical requests (affects the repeatability probe and fixtures).
- [ ] Whether the pinned model ID is still `typesafe/jev-1.13` and still available.
- [ ] Any terms of use that affect publishing results.

If any answer changes an assumption in this document, stop and report it before continuing.

---

## 19. Handoff Notes for the Coding Agent

### 19.1 How to start

- Save this file as `requirements.md` in the repo root.
- Read sections 0, 3, 5, 6, 9 and 19 first. They define what the project must measure and how to work. Read the rest as each step needs it.
- First commit: create `docs/hypotheses.md` from section 3, dated.
- Work in the order of section 17, one checkpoint at a time (section 19.2).

### 19.2 Checkpoints (stop and report)

At each checkpoint, stop, summarize what you did and show the listed results. Do not start the next step until the owner replies. A checkpoint report is short: what was built, what was checked, what looks wrong or surprising.

| Checkpoint | After | Show |
|---|---|---|
| C1 | Build step 1: domain and simulator | Tests pass for seeded determinism and common random numbers. Generated stream statistics next to the configured distributions (amount buckets, country mix, payment methods). One example transaction with its world probabilities and a simulated outcome. |
| C2 | Build step 2: rule routers and batch runner (no Jev) | Batch results for R0, R1, R2 on all six scenarios, 20 seeds, with confidence intervals. The tuned R2 parameters. The size of the gap between R0 and R2, so it is clear whether there is room for any router to matter. Counts of single-eligible and zero-eligible transactions per scenario. Flag any scenario where R1 and R2 are identical or where all routers score about the same. |
| C3 | Section 18 (verify before coding), before the Jev adapter | The filled-in `docs/jev-api-notes.md`. Say explicitly if any answer changes an assumption in this document. |
| C4 | Build step 3 and the pilot in step 4 | The adapter works against mocks and recorded fixtures. Pilot run (one scenario, one seed): number of calls, cost, average and worst latency, invalid and failed response rate, a sample request and response. Estimated cost and time of the full batch. Do not start the full batch without approval. |
| C5 | Full live batch, probes, data richness and sensitivity runs | All results from section 9, with fixtures and result files committed. Do not build the web page until the owner has reviewed the results. |
| C6 | Build step 6: web page | Running page, rate limit and daily cap working, key not exposed to the browser. |

The owner may change the order or skip a checkpoint by saying so. Without that, always stop.

### 19.3 Rules

- Do not build UI before the experiment runs end to end without Jev (C2).
- Do not change hypotheses, outcome definitions, metric definitions, seed counts or the split without asking.
- Keep all numbers (world, stream, scenario, tuned rules) in config files, not in code.
- Never add a real PSP integration, real payment fields or real PSP branding.
- Never expose the OpenRouter key to the client or logs.
- Never call live Jev in CI or in tests. Use mocks and fixtures.
- Run live Jev calls only after C4 approval, and run the full batch once. Reuse recorded fixtures afterwards.
- Run batch jobs with parallel requests, retries and resumable progress, so an interrupted run does not start over.
- If something in this document is ambiguous or contradicts the live API, ask before guessing.
- If a result looks too good or too bad to be true, check for a bug first and report it at the next checkpoint.

---

## 20. Limitations to Document

- This project does not prove that Jev improves real-world payment routing.
- The simulator is synthetic. Conclusions depend on how the world was designed, which is why the sensitivity check exists.
- Observed data comes from a background history independent of routing, so exploration and feedback loops are not tested.
- Only one decision type is tested in the first version.
- Results apply to one model version at one point in time.
- Sensitivity runs use 5 seeds on one scenario, fewer than the main results, to keep the number of paid Jev calls bounded.
- Jev's probabilities are model outputs, not guarantees or calibrated odds, unless the calibration probe shows otherwise.
- Currency conversion uses fixed simulation constants, not market rates.
- A real payment router needs far more data, controls, monitoring, resilience, compliance review and domain optimization.

---

## 21. Terminology Note

"Decision Schema" and "Decision Memory" are application-level concepts in this project. They are not native Jev features unless the chosen API version says so. Decision Memory, when added later, is application-owned history supplied as extra state. It does not retrain or change the model.

---

## 22. References

Re-verify these before integration, since API details and pricing can change.

- OpenRouter, Jev 1.13 model: https://openrouter.ai/typesafe/jev-1.13/api
- OpenRouter, Jev tutorial and Decisions API: https://openrouter.ai/blog/tutorials/how-to-use-jev/
- OpenRouter, Jev overview: https://openrouter.ai/blog/insights/what-is-jev/
- TypeSafe, System One API reference: https://api.typesafe.ai/docs
- TypeSafe, System One and Jev overview: https://typesafe.ai/blog/introducing-system-one-models-and-jev
