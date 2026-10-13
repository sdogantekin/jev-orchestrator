# Payment Decision Lab — Experiment Report

**Status:** complete (all planned runs executed and committed). Written 2026-10-13.
**Audience:** anyone who wants the full picture — human readers and other AI systems alike. This
document is self-contained: it does not assume you've read the rest of the repo first.

---

## 1. Executive summary

**Question tested:** can Jev, a probabilistic decision model from TypeSafe, be a strong
alternative to rule-based decision making in payment orchestration — specifically, choosing
which payment service provider (PSP) should handle a transaction's first attempt?

**Answer:** no, not in this experiment. Across 6 simulated scenarios, 20 seeds each, and
~172,000 real API calls to Jev, a well-tuned rule-based router (R2) beat Jev on the headline
metric (authorization rate) in every single scenario, significantly so in 4 of 6, and that
result held up under every one of 9 deliberate perturbations to the simulated world. Critically,
the one hypothesis that gave Jev a plausible path to winning — that it would do better than
static rules when those rules go stale or the data is thin — was **not supported**: Jev's
disadvantage was as large or larger in exactly those scenarios.

This is not a story of Jev being broken or incoherent. It responds sensibly and predictably to
the data it's given, stays consistent under harmless input changes, and disagrees with the rule
router on roughly half of all decisions — meaning it's doing real, independent reasoning, not
noise. It just doesn't win. Specifically, it appears to weight a PSP's likelihood of approving a
payment far more heavily than the fee that PSP charges, even when explicitly instructed to use
fee as a tiebreaker — a rule engine follows that instruction exactly; Jev did not reliably.

Everything below explains how we got to that answer, in enough detail to check our work or to
disagree with our interpretation.

---

## 2. Background and motivation

The project started from a public claim: Jev is supposedly weak at content generation — the
kind of thing a typical large language model does — but very good at structured decisions made
from a given data set. That claim comes from TypeSafe and OpenRouter's own marketing and
documentation; **it is a claim, not evidence**, and testing the second half of it (the decisions
part) in a concrete, economically important setting is the entire point of this project.

Payment orchestration — the layer that decides which payment processor should handle a given
transaction — is a good test bed for three reasons:

1. It's a real, economically meaningful decision (affects authorization rates and fees at
   scale) that today is almost universally handled by hand-written or lightly-tuned rule
   engines.
2. The decision has a small number of discrete options (which PSP?), a quantifiable outcome
   (did it authorize? what did it cost?), and inputs that can be faithfully simulated without
   touching any real payment infrastructure.
3. It's exactly the kind of "structured decision from a given data set" the claim is about —
   not a content-generation task, where Jev is claimed to be weak, and not a toy benchmark.

The project is explicit that it is **not** trying to build a payment product. It is trying to
get an honest answer to one narrow question, and to report that answer even if — especially if
— it's unflattering to Jev.

---

## 3. Hypotheses

Committed in `docs/hypotheses.md`, dated, **before** any simulator or router code existed, so
nothing below could be fitted to a result we'd already seen.

| ID | Hypothesis |
|---|---|
| H1 | Jev responds correctly to the data it is given: when one PSP's metric improves and everything else is fixed, its probability for that PSP rises sensibly. |
| H2 | On stable traffic, Jev roughly matches a well-tuned rule set. |
| H3 | When rules go stale (a PSP degrades mid-stream) or data is thin (cold start, rare segments), Jev does better than static rules. |
| H4 | Jev loses to rules on decision latency, cost per decision, determinism and auditability. |
| H5 | Jev's output is mostly but not perfectly consistent: repeated calls and harmless input changes (PSP order, field order) sometimes change the choice. |

The project's own stated expectation, written down before running anything: *"The most likely
honest result is 'competitive where rules are stale or data is thin, not better than a tuned
rule elsewhere.' That is a useful finding, and the project should be comfortable reporting it."*
Keep that sentence in mind — it matters when we get to Section 8.

---

## 4. Experiment design, and why it's built this way

### 4.1 Safety boundary

Non-negotiable, and worth stating plainly: the app never processes, authorizes, captures,
refunds, routes, or executes a real payment, never connects to a real PSP/bank/network, and
never accepts or stores real cardholder data. The three PSPs (`Alpha`, `Beta`, `Gamma`) are
entirely synthetic. This matters for the design, not just for safety: it means every number in
this report — acceptance rates, fees, latencies, chargebacks — is **generated by a simulator we
built and fully control**, not observed from the real world. That's a deliberate trade: it lets
us run a clean, repeatable, free-to-replay experiment, at the cost of needing to be honest that
conclusions depend on how we designed that simulated world (see Section 10).

### 4.2 The simulator: world vs. observed

The single biggest design decision, and the one most likely to silently invalidate the whole
experiment if gotten wrong, is this: **every router (including Jev) sees the same imperfect,
noisy view of PSP performance — never the ground truth.**

- **World**: the true acceptance probabilities, including hidden effects (e.g. "PSP Beta does
  better on EUR card payments from Germany or the Netherlands") and scheduled drift (e.g. "PSP
  Beta's acceptance drops by 8 points starting at transaction 600"). No router ever sees this
  directly.
- **Observed**: a noisy, slightly stale summary computed from a rolling window of background
  transaction history (default: a 150-transaction window, lagged by 50 transactions). This is
  what every router — R0 through R3 — actually receives.

Why this split matters: if routers could see the true world probabilities directly, a simple
lookup table would be mathematically optimal and no router (rule-based or Jev) could ever beat
it except by luck. The gap between world and observed is what makes "which router reasons better
under uncertainty" a real, non-trivial question.

**Common random numbers**: every simulated outcome (did this PSP authorize? was it available?
what was the latency? was there a chargeback?) is a deterministic function of
`(seed, transaction index, PSP id, step)`, computed via a hash, not a stateful random number
generator. This means if two different routers choose the same PSP for the same transaction,
they get the *identical* simulated outcome — differences between routers can only come from
differences in *which PSP they chose*, never from random noise landing differently. This is what
makes paired, seed-by-seed comparison between routers statistically meaningful rather than just
noisy.

### 4.3 The six scenarios, and what each is designed to test

All scenarios share the same base world (three PSPs with realistic, closely-clustered base
acceptance rates of 92.0–94.5%) and the same 1,000-transaction stream shape (reused across every
comparison), but each perturbs one thing:

| Scenario | What changes | What it's testing |
|---|---|---|
| **Stable** | Nothing — the baseline. | The clean, uncomplicated case: does Jev roughly match tuned rules when nothing is going wrong? (H2) |
| **Drift** | PSP Beta's true acceptance drops 8 points at transaction 600; the observed view only reflects this after the lag. | Does Jev adapt faster than static rules when the ground truth silently changes mid-stream? (H3) |
| **Thin data** | PSP Beta's observed history for one specific segment (EUR, Germany, card) is artificially capped at ~25 attempts. | Does Jev do better than rules when there's very little evidence for a specific case? (H3) |
| **Cold start** | PSP Gamma's entire observed history is capped at ~20 attempts, as if it just launched. | Same question as thin data, but for a whole PSP rather than one segment. (H3) |
| **Conflicting objectives** | PSPs' acceptance, cost, and fee move in different directions (the highest-acceptance PSP is also the most expensive); amounts skew toward larger transactions. | Does the choice between "safest" and "cheapest" become harder to call correctly, and who handles that trade-off better? |
| **Eligibility mix** | The payment-method mix shifts so that hard eligibility exclusions (e.g. a PSP that doesn't support PayPal) happen much more often. | Does a noisier eligible-candidate set change which router does better? |

### 4.4 The four routers — and why R2, not R0, is the real baseline

| Router | What it is |
|---|---|
| R0 | Naive floor: always picks PSP Alpha (or the first eligible PSP). Exists only to show there's room for *any* router to matter — beating this proves nothing. |
| R1 | Hand-tuned rules: an explicit, ordered rule list reflecting what a payments team would plausibly write from PSP contracts and dashboards (e.g. "prefer Beta for EUR card payments from DE/NL/FR," "prefer the cheapest PSP for small amounts," with a safety fallback if the preferred PSP looks unreliable). |
| R2 | The same rule *structure* as R1, but with every tunable parameter (which PSP is preferred per rule, amount thresholds, safety thresholds) chosen by grid search on a held-out training slice, then frozen. |
| R3 | Jev. Selects a PSP from the exact same eligible-candidate set and observed view every other router receives — nothing more, nothing less. |

The project's design explicitly rejects comparing Jev only against R0 or R1: *"Beating R0 proves
nothing. The claim only means something against R2."* R2 represents the best a conventional,
non-learning rules engine could plausibly do with the same information Jev has — that's the bar
that actually matters.

**A methodological wrinkle worth being upfront about**: our first attempt at tuning R2 used a
grid search (1,458 parameter combinations) scored against a *single* training stream. It
overfit badly — the chosen parameters scored 95.0% on the exact stream they were tuned on, but
only 92.2% on the real 20-seed evaluation, actually *worse* than the untuned R1. We caught this
by re-scoring the chosen parameters against the stream they were tuned on and seeing the gap.
The fix: pool the score across 5 separate tuning streams instead of 1 before picking the best
parameters. That fixed it — R2 no longer loses to R0/R1 anywhere after the fix. This is disclosed
in detail in `docs/assumptions.md` (#8) because it's a deviation from the literal requirements
text ("tune... on *a* stream," singular), made deliberately and for a concrete, verified reason,
not silently.

### 4.5 What Jev actually sees (the "Decision Contract")

This is the part most load-bearing for the experiment's validity, so it's worth spelling out
exactly what crosses the wire:

- **Transaction context**: amount (in EUR), currency, country, payment method, card scheme,
  device, customer type, 3DS eligibility, amount bucket.
- **Per eligible PSP**: its exact (non-noisy) fixed fee and variable cost percentage, a derived
  "expected fee for this transaction" field, and its *observed* (noisy) acceptance rate,
  availability rate, chargeback rate, and average latency — each with a sample size attached.
- **A plain-language objective**: "Choose the payment service provider most likely to result in
  a successful authorization for this specific transaction. If two providers seem comparably
  likely to authorize it, prefer the one with the lower expected fee."
- **An explicit metric glossary**: every field above gets a one-sentence definition in the
  request (e.g. "acceptance_rate_overall: share of this PSP's past attempts, across all
  transaction types, that ended in a successful authorization"). Jev is never expected to infer
  payments jargon on its own.

What Jev **never** sees: any hidden world value (true acceptance rates, segment effects, drift),
any scenario name, any router name, or any other hint about the experiment's design. This is
checked by an automated "contract test" that asserts specific known world-only numbers never
appear anywhere in the serialized state sent to the API.

Three **data richness levels** were tested (Section 6.3): Level 1 (overall observed stats only),
Level 2 (adds segment-specific acceptance — the default for all main results), and Level 3 (adds
each PSP's last 20 outcomes in the same segment, as raw history rather than a summary).

### 4.6 Outcome and metric definitions (frozen before results existed)

- **Authorized**: the PSP was available and the authorization draw succeeded.
- **Net cost of a transaction**: fee (if authorized) plus chargeback loss (if a chargeback
  occurred), in EUR.
- **"Better" outcome when two routers disagree on the same transaction**: authorized beats not
  authorized; if both have the same authorization result, lower net cost wins; otherwise it's a
  tie.
- **Headline metric**: authorization rate on the test slice.
- **Secondary metric**: net cost per authorized transaction.

These were fixed before any batch ran and never adjusted afterward.

### 4.7 Scale and statistical method

- 1,000 simulated transactions per stream; transactions 0–299 are the training slice (used only
  for tuning R2), 300–999 are the test slice (used for every reported result).
- 20 seeds per scenario for the main comparison, every router evaluated on the *identical*
  streams (paired comparison, not independent samples).
- 5 seeds for the sensitivity check (explicitly fewer, and never mixed into the main tables,
  because every world variant multiplies the number of paid Jev calls).
- Every rate reported with a 95% confidence interval from bootstrap resampling over transactions
  (2,000 resamples), so "R2 beats Jev" claims are backed by non-overlapping intervals, not raw
  point estimates.

---

## 5. Execution

### 5.1 Build order and verification checkpoints

The project was built in a fixed order, stopping to report real results at each checkpoint
rather than building everything then checking once at the end: domain model and simulator →
rule routers and tuning → verifying the real Jev API against live docs → the Jev adapter → a
small live pilot → the full batch. Each checkpoint's actual output is committed in version
control, not just described after the fact.

### 5.2 What was verified about the real API before writing any adapter code

Before writing a line of integration code, the exact request/response shape, pricing, and
behavior of the live Jev API were checked against OpenRouter's and TypeSafe's own documentation
(`docs/jev-api-notes.md`). Two findings mattered enough to flag:

- **Jev's output is not perfectly deterministic.** OpenRouter's own documentation shows the same
  input returning different confidence values across repeat calls (example they publish: 0.52
  then 0.49). This directly validates H5 as a real, worth-testing property rather than a
  formality, and is why every recorded fixture replays the exact bytes received rather than
  assuming a fresh call would match it.
- **A ToS concern that turned out to be a false alarm.** A search initially suggested
  OpenRouter's terms ban publishing benchmark results. Checking the actual terms directly showed
  that restriction only applies to their separate "Stealth Program" (undisclosed pre-launch
  models) — Jev is a publicly documented, priced, non-stealth model, so it doesn't apply. Worth
  mentioning because it would have been a real blocker if the initial read had been trusted
  without checking the primary source.

### 5.3 Live run summary

| Phase | Live calls (paid) | Result |
|---|---|---|
| Pilot (1 scenario, 1 seed) | 700 | 700/700 ok, $0.042 total, 305ms avg / 840ms worst latency |
| Probes (responsiveness, trade-off, irrelevance, repeatability) | ~72 | all ok |
| Main comparison (6 scenarios × 20 seeds × 700) | 84,000 | 84,000/84,000 ok — **0 invalid, 0 failed, 0 fallback** |
| Data richness (levels 1 & 3 on stable + drift; level 2 reused existing fixtures for free) | 56,000 | all ok |
| Sensitivity (9 world variants × 5 seeds on stable) | 31,500 | all ok |
| Calibration | 0 (derived from already-recorded data) | 228,746 (PSP, probability) samples analyzed |
| **Total** | **~172,000** | **0 failures anywhere** |

Total real spend: roughly $10–11, matching the project's own pre-registered cost estimate
almost exactly. Every one of the ~172,000 responses is cached locally by a hash of the exact
request and can be replayed for free (kept out of version control only because 84,000+ individual
files made for an impractical repo size — see `docs/assumptions.md` #11 for the reasoning and the
one genuinely informative side-effect of that design: the cache essentially never gets a hit on
repeat batches, because the state includes the exact transaction amount rather than just its
bucket).

Two implementation bugs were caught and fixed *before* being reported as findings, both
documented in commit history and `docs/assumptions.md` for anyone checking this work:

1. An early version of the responsiveness probe swept one PSP's overall acceptance rate while
   leaving its segment-specific acceptance rate frozen at an inconsistent value — feeding Jev a
   self-contradictory state (e.g. "10% overall but 92% in this exact segment"). That produced a
   backwards-looking result that was *not* a real finding, just a confound. Fixed before trusting
   it (see Section 6.4).
2. A results file (`probes.json`) briefly contained stale data because an earlier run's output
   was piped through a command (`tee file | head -40`) that can kill the writing process early.
   Caught via a rendering bug (a malformed chart) while building the results page, traced to the
   root cause, and fixed by re-running without the truncating pipe and verifying the output
   directly before trusting it again.

Both are called out specifically because a report like this is only useful if a wrong number
that *looked* plausible gets caught before being presented as a finding, not after.

---

## 6. Results

### 6.1 Main comparison: authorization rate by scenario

All figures: test slice, 20 seeds, 14,000 decisions per scenario, 95% bootstrap CI in brackets.

| Scenario | R0 | R1 | R2 | Jev (R3) | R2 − Jev gap | Statistically significant? |
|---|---|---|---|---|---|---|
| Stable | 94.21% | 94.29% | 94.06% [93.66, 94.44] | 93.36% [92.96, 93.77] | 0.70pp | Barely overlapping — borderline |
| Drift | 94.10% | 94.06% | 93.83% [93.43, 94.24] | 93.06% [92.65, 93.47] | 0.77pp | Barely overlapping — borderline |
| Thin data | 94.04% | 94.31% | 94.29% [93.90, 94.66] | 93.14% [92.73, 93.56] | **1.15pp** | **Yes** |
| Cold start | 94.27% | 94.57% | 94.31% [93.91, 94.69] | 93.34% [92.92, 93.74] | 0.97pp | **Yes** |
| Conflicting objectives | 95.41% | 95.65% | 95.93% [95.61, 96.26] | 94.57% [94.21, 94.93] | **1.36pp** | **Yes** |
| Eligibility mix | 93.96% | 93.97% | 93.99% [93.60, 94.39] | 92.79% [92.36, 93.22] | 1.20pp | **Yes** |

**R2 beats Jev's authorization rate in all six scenarios**, with a statistically significant
gap (non-overlapping confidence intervals) in four of them. On net cost per authorized
transaction, the picture flips the other way more often than not: Jev is actually *cheaper* than
R2 in four of the six scenarios (thin_data: €1.89 vs €2.05; cold_start: €2.01 vs €2.05;
conflicting_objectives: €3.50 vs €3.68; eligibility_mix: €2.01 vs €2.05), and R2 is cheaper only
on stable (€2.08 vs €2.15) and drift (a near-tie, €2.17 vs €2.17). None of this offsets the
authorization-rate gap under the project's own outcome definition, where authorization always
dominates cost — but it's a genuine secondary finding worth not losing: Jev's choices tend to run
cheaper when they do authorize, it's authorizing *less often* that costs it the overall
comparison.

### 6.2 The disagreement table: not just "who's better on average"

| Scenario | Disagreement rate | On disagreement: Jev wins | R2 wins | Ties |
|---|---|---|---|---|
| Stable | 54.2% | 2,754 | 4,801 | 35 |
| Drift | 44.3% | 3,861 | 2,300 | 39 |
| Thin data | 55.0% | 3,657 | 4,006 | 35 |
| Cold start | 47.7% | 2,052 | 4,582 | 39 |
| Conflicting objectives | 50.5% | 4,002 | 3,046 | 23 |
| Eligibility mix | 50.0% | 3,682 | 3,283 | 31 |

Two things worth noticing. First, **disagreement is the norm, not the exception** — Jev and R2
pick a different PSP on 44–55% of all decisions, even where their aggregate authorization rates
land close together. They are not converging on the same strategy by a different route; they are
genuinely reasoning differently. Second, R2 wins more disagreements than Jev in 4 of 6 scenarios,
but the margin varies a lot by scenario — drift and conflicting_objectives are the two places
Jev actually wins *more* individual disagreements than R2, yet R2 still has the better *overall*
authorization rate in both. That apparent contradiction is explained in Section 7.2: many of
Jev's "wins" are cost wins on transactions both routers would have authorized anyway, which move
net cost but not authorization rate.

### 6.3 Sensitivity check: does any of this depend on fragile assumptions?

Nine deliberate perturbations to the simulated world, each run on the Stable scenario with 5
seeds (fewer than the main results — a robustness check, never mixed into the main numbers):

| Variant | What changed | Jev auth | R2 auth | Gap (R2 − Jev) | Conclusion flipped? |
|---|---|---|---|---|---|
| segment_half | Hidden segment effects halved | 92.54% | 93.63% | 1.09pp | No |
| segment_double | Hidden segment effects doubled | 94.17% | 95.11% | 0.94pp | No |
| drift_0.04 | A small drift injected into the otherwise-stable world | 92.89% | 93.34% | 0.46pp | No |
| drift_0.12 | A larger drift injected | 93.46% | 93.71% | 0.26pp | No |
| lag_25 | Observed-data lag halved | 93.83% | 94.63% | 0.80pp | No |
| lag_100 | Observed-data lag doubled | 92.49% | 93.91% | **1.43pp** | No |
| window_75 | Observed-data window halved | 93.23% | 93.54% | 0.31pp | No |
| window_300 | Observed-data window doubled | 93.37% | 93.94% | 0.57pp | No |
| chargeback_fee_25 | Chargeback cost assumption raised | 93.09% | 93.60% | 0.51pp | No |

**None of the nine variants flipped the direction of the result.** R2 beat Jev in every one,
with the gap ranging from 0.26 to 1.43 percentage points depending on the variant. This is
meaningful because it means the main finding isn't an artifact of one specific, fragile choice
of simulator parameters — it's reasonably robust to how those parameters are set.

### 6.4 Data richness: does giving Jev more data change anything?

Levels 1 (overall stats only), 2 (adds segment-specific stats — the default), and 3 (adds the
last 20 raw outcomes per segment), same 20 seeds, on Stable and Drift:

| Scenario | Level 1 auth | Level 2 auth | Level 3 auth | Choice changed 1→2 | Choice changed 2→3 |
|---|---|---|---|---|---|
| Stable | 93.58% [93.19, 93.97] | 93.36% [92.97, 93.78] | 93.43% [93.04, 93.85] | 21.9% | 4.1% |
| Drift | 93.47% [93.06, 93.89] | 93.06% [92.61, 93.46] | 93.09% [92.65, 93.51] | 20.1% | 4.9% |

Authorization rate is statistically indistinguishable across all three levels (heavily
overlapping confidence intervals) in both scenarios. But the *choice itself* shifts substantially
going from Level 1 to Level 2 (20–22% of decisions change) and comparatively little from Level 2
to Level 3 (4–5%). In other words: giving Jev segment-specific summaries changes its behavior a
lot; additionally giving it raw recent history on top of that barely changes its behavior at all,
and doesn't measurably change the outcome either way. This directly supports the idea that
richer summaries (Level 2) already capture most of what matters, and feeding raw history (Level
3) is mostly wasted cost — exactly the question the project set out to answer here.

### 6.5 Probes: four targeted single-decision tests, plus one derived for free

**Responsiveness (tests H1).** One PSP's acceptance rate was swept from 0.75 to 0.99 against a
fixed competitor sitting at 0.945, holding everything else fixed (3 repeated calls per step).
Result: a clean, monotonic, textbook curve — the swept PSP's selection probability stays near
zero until it approaches the competitor's value, then flips sharply to ~100% right at and past
the crossover point:

```
Acceptance rate of swept PSP → probability of choosing it
0.75 → 0%      0.85 → 1%      0.93 → ~5-6%
0.80 → 0%      0.90 → ~2%     0.945 (tie) → 100%     0.96-0.99 → 100%
```

At the exact tie point, the swept PSP (which also happened to have the lower fee) won decisively
— consistent with the stated objective's instruction to use fee as a tiebreaker when acceptance
is comparable. **This is a clean, strong confirmation of H1.** (An earlier, flawed version of
this probe — using three PSPs with inconsistent segment data — had produced a confusing,
backwards-looking result; see Section 5.3, point 1. The version above is the corrected one.)

**Trade-off (also tests H1).** Two synthetic PSPs: one with higher acceptance (0.94) and a higher
fee, one with lower acceptance (0.93, a 1-point gap) and a much lower fee. The project's
hypothesis was that small transactions should lean toward the cheaper option. Result: Jev picked
the higher-acceptance, more expensive PSP in **all 10 of 10 calls**, at both a small amount (€10)
and a large amount (€800). No small-amount-prefers-cheap effect showed up at this acceptance gap.
This is a real, negative finding, not a bug — and it connects directly to the calibration result
below.

**Irrelevance (tests H5).** Five harmless transformations of an otherwise identical decision
(shuffled PSP order, renamed display names, a reordered metric glossary, an added unrelated
field), 3 repeats each. Result: **15 out of 15 calls kept the same choice.** Clean pass.

**Repeatability (tests H5).** The exact same state, called live 20 independent times. Result:
the choice never changed (0 of 20), but confidence drifted noticeably within a narrow band
(0.92–0.95, mean 0.941) across calls that were, as far as the system is concerned, identical
requests. Consistent with both H5 and with OpenRouter's own documented behavior (Section 5.2).

**Calibration (derived from the main comparison's data, no extra calls).** The question: "when
Jev states probability *p* for a PSP, how often is that PSP actually the best option?" "Best"
here means the ground-truth best PSP among the eligible set for that transaction (the same
authorized-beats-not-authorized-else-cheaper rule from Section 4.6), not simple authorization.

| Jev's stated probability | Actual "best PSP" rate |
|---|---|
| ~3% | 34.4% |
| ~14% | 53.5% |
| ~24% | 53.0% |
| ~34% | 49.2% |
| ~45% | 41.8% |
| ~55% | 28.5% |
| ~65% | 18.6% |
| ~75% | 16.5% |
| ~85% | 24.2% |
| ~95% | 40.6% |

This is not what a well-calibrated curve looks like — if anything the actual rate *falls* as
Jev's stated confidence rises through most of the range, then partially recovers at the very top.
We checked carefully for a bug and didn't find one (see Section 7.3 for the mechanism) — this is
a real, if initially surprising, pattern, fully explained by the trade-off probe's finding above.

---

## 7. Interpretation

### 7.1 What the headline result actually means

R2 — a rule engine whose only "intelligence" is a parameter search done once, offline, and then
frozen — consistently out-authorizes Jev by roughly 0.3–1.4 percentage points across every world
we tested, and that gap survives every robustness check we ran. On a per-transaction basis this
is a small effect; at the scale a real payment platform operates, a sustained ~1-point
authorization-rate gap is a meaningful amount of revenue. Jev is not a disaster — it's in the
same neighborhood as R2, just reliably a bit behind — but "a strong alternative to rule-based
decision making," the question this project set out to test, is not supported by this data.

### 7.2 Resolving the apparent paradox in the disagreement table

In drift and conflicting_objectives, Jev wins *more individual disagreements* than R2, yet R2
still has the *better overall authorization rate* in both. This isn't a contradiction once you
remember that a "win" under the project's outcome rule can come from two different places: (a)
Jev's choice authorized when R2's choice didn't (this moves authorization rate), or (b) both
choices would have authorized, but Jev's was cheaper (this moves net cost, not authorization
rate). Many of Jev's wins are type (b). So Jev can rack up wins on cost while still landing fewer
transactions in the "authorized" column overall — the two metrics aren't telling the same story,
and the project's own outcome rule (Section 4.6) correctly treats authorization as dominant.

### 7.3 Why the calibration curve looks "backwards," and why that's not a contradiction

This result traces directly back to the trade-off probe. In this simulated world, every PSP's
base acceptance rate is high and clustered (92–94.5%), so on a large share of transactions *every
eligible PSP would authorize anyway*. When that's true, the ground-truth "best" PSP for that
transaction is decided by fee, not acceptance — there's nothing else left to decide it. But Jev,
per the trade-off probe, weights acceptance far more heavily than fee, even when the two PSPs are
close enough that the stated objective explicitly calls for using fee as the tiebreaker. So: when
Jev states high confidence in a PSP, it's very often expressing "I believe this one authorizes
best," which — in a world where almost everything authorizes anyway — frequently loses to a
cheaper alternative on the *actual* best-PSP criterion. And when Jev states low confidence, it's
often *because* the PSP it's hedging on is the cheap one it's underweighting, which goes on to
win on cost once you account for the near-universal authorization. Two independent probes (trade-
off and calibration) are pointing at the same underlying behavior from two different angles,
which is why we trust this is real and not an artifact.

### 7.4 What this says about production readiness (H4)

Beyond the headline metric, every other axis that matters for a production payment system also
favors rules: Jev adds ~270–285ms of latency per decision (worst case over 3 seconds observed)
against a rule's effectively-zero evaluation time, costs a small but nonzero amount per call
against a rule's zero marginal cost, and is confirmed (Section 5.2, and directly observed in the
repeatability probe) to not be perfectly deterministic. On auditability, it's more nuanced than a
flat "loses": every Jev decision does come with a full probability distribution, a stated
confidence, and the exact raw request/response, which is considerably more introspectable than
"the model said so" — but it's still not traceable to a specific, human-written rule the way R1
or R2's decisions are, which matters for regulated-industry audit requirements in a way this
project doesn't attempt to adjudicate further.

---

## 8. Hypothesis-by-hypothesis verdict

| ID | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | Jev responds correctly to the data it's given. | **Supported.** | The corrected responsiveness probe (Section 6.5) shows a clean, monotonic, sensible response, including a sensible fee-based tiebreak exactly at a crossover point. |
| H2 | On stable traffic, Jev roughly matches a well-tuned rule set. | **Weakly contradicted.** | R2 beats Jev by 0.70pp on Stable, a gap whose confidence intervals barely overlap — "roughly matches" is generous; R2 is consistently a bit ahead, even here. |
| H3 | Jev does better than static rules when rules go stale or data is thin. | **Not supported — the opposite, if anything.** | The gap in thin_data (1.15pp) and cold_start (0.97pp) is *larger* than on Stable (0.70pp), not smaller. This was the one hypothesis that could have made the whole case for Jev, and the data points the other way. |
| H4 | Jev loses to rules on latency, cost per decision, determinism, and auditability. | **Supported**, with a nuance on auditability. | ~270ms+ latency and nonzero cost per call are unambiguous; determinism is confirmed imperfect; auditability is "different, not simply worse" — Jev offers rich introspection data even though it isn't rule-traceable. |
| H5 | Jev's output is mostly but not perfectly consistent. | **Supported.** | 0/20 choice changes under repeatability but real confidence drift (0.92–0.95); 15/15 consistent under harmless input changes (irrelevance). "Mostly but not perfectly" is close to exactly right. |

The project's own pre-registered expectation — *"competitive where rules are stale or data is
thin, not better than a tuned rule elsewhere"* — turns out to be **more optimistic about Jev
than what we actually found**. We didn't even get "competitive" in the stale/thin-data cases;
R2's advantage was larger there, not smaller.

---

## 9. Conclusion

In this experiment, Jev is not a better alternative to a well-tuned rule-based router for
single-attempt PSP selection. It loses on the headline metric in every scenario tested,
significantly in most, and that result is robust to nine different ways of perturbing the
simulated world. It specifically fails to show the one advantage — handling staleness or thin
data better than static rules — that would have made the strongest case for using it. It also
costs more, is slower, and is less deterministic than the rules it's being compared against.

That is not the same as saying Jev is incoherent or unprincipled. It responds sensibly and
predictably to the information it's given (H1), stays consistent under changes that shouldn't
matter (H5), and disagrees with the rule engine on roughly half of all decisions in ways that are
explainable, not random. The core, reproducible behavioral finding underneath the headline number
is that **Jev weights a PSP's likelihood of approving a payment much more heavily than the fee it
charges**, even when explicitly told to use fee as a tiebreaker in close calls — a rule can be
written to do that with surgical precision; Jev, as tested here, did not reliably follow that
instruction.

Whether that's a fixable prompting/schema problem, a deeper property of how the model was
trained, or something else, is outside what this experiment can answer — we only tested one
model version, one decision type, one way of phrasing the objective and the schema, at one point
in time. See Section 10 for the full list of what this study does and doesn't tell you.

---

## 10. Limitations

- This project does not prove that Jev improves or fails to improve real-world payment routing
  — only that it didn't win in this synthetic simulation, under these specific design choices.
- The simulator is synthetic. Results depend on how the world was designed; the sensitivity
  check (Section 6.3) is our attempt to show the headline conclusion isn't fragile to that, but
  it can't rule out every possible world design.
- Observed data comes from a background history that is independent of routing choices, so
  exploration and feedback loops (what happens if a router's choices change what data gets
  collected) are not tested at all.
- Only one decision type (first-attempt PSP selection) is tested. Retry decisions, 3DS/frictionless
  choice, and fallback cascades are explicitly out of scope.
- Results apply to one pinned model version (`typesafe/jev-1.13`) at one point in time
  (October 2026). The model could change.
- The sensitivity check uses 5 seeds on one scenario, fewer than the main results, specifically
  to bound the number of paid Jev calls — it's a robustness check, not a full replication.
- Jev's probabilities are model outputs, not guaranteed-calibrated odds — Section 6.5's
  calibration result is itself evidence of this, not an assumption we made going in.
- Currency conversion uses fixed simulation constants, not live market rates.
- A real production payment router would need far more data, monitoring, compliance review, and
  domain-specific tuning than either R2 or Jev received here — this experiment compares two
  decision *mechanisms* under matched, limited information, not two finished products.
- We tested one phrasing of the objective and one Decision Schema. We did not test whether a
  different instruction phrasing, a stronger emphasis on cost in the objective text, or a
  different schema shape would change Jev's acceptance-over-cost behavior. That's a reasonable
  next experiment, not something this one rules out.

---

## 11. What it would take to use something like this in a real platform

Even setting the results aside, using a model like Jev for live payment routing in production
would require, at minimum: hard eligibility and safety rules enforced in code (never delegated to
the model), a deterministic fallback path for invalid or failed responses (this project already
builds and exercises that — see `lib/jev/decide.ts`), monitoring for drift in the model's
behavior over time, full request/response logging for audit, a clear answer on latency budget
and cost at the platform's real transaction volume, and a methodology for re-validating the
comparison whenever the pinned model version changes. None of that is a reason not to test the
idea — it's the list of what separates "we ran an honest experiment" from "we shipped it."

---

## 12. Where the underlying data lives

Every number in this report is backed by a committed file, not a summary written after the fact:

- `docs/hypotheses.md` — the five hypotheses, dated before the first run.
- `docs/assumptions.md` — every implementation judgment call made where the requirements were
  silent, including the two methodological issues disclosed in Section 5.3.
- `docs/jev-api-notes.md` — what was verified against the live Jev API before any adapter code
  was written.
- `experiments/results/*.json` — the raw output of every batch run referenced in Section 6:
  `{scenario}.json` (R0/R1/R2), `jev-main-{scenario}.json` (Jev vs. R2), `sensitivity.json`,
  `data-richness-{stable,drift}.json`, `probes.json`, `calibration.json`.
- `experiments/scripts/*.ts` — the exact code that produced every one of those files; all are
  re-runnable (see `README.md`).
- The Results page (`/results` in the running app) renders all of the above as charts and tables,
  each linked to the hypothesis it tests.

This report is long on purpose: the point of the exercise was to get a real, checkable answer,
not a confident-sounding one.
