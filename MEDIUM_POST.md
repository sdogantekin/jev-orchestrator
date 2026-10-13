# Can a decision model replace my payment routing rules? I tested Jev.

*A simulation-only experiment. No real payment was ever processed, authorized, or routed —
everything below comes from a simulator I built and fully control. Full methodology, code, and
raw data: [link to repo] · Live results and playground: [link to page]*

---

## 1. Why I ran this

If you've worked anywhere near payments, you know how orchestration actually works today: a
rules engine, usually hand-tuned over years by whoever's on call when a PSP has a bad week.
*"Prefer Processor A for EUR card payments from Germany." "Fall back to B if A's approval rate
drops below X." "Route small amounts to whichever is cheapest."* It works, but it's brittle — the
rules go stale the moment a PSP's real-world behavior drifts, and nobody wants to be the person
who has to notice that and rewrite the thresholds.

So when I saw TypeSafe and OpenRouter's own claim about their model Jev — that it's weak at the
kind of content generation a typical LLM does, but *very good at structured decisions made from a
given data set* — I wanted to test the second half of that claim somewhere it actually matters
economically, not on a toy benchmark. Payment routing is a good fit: a small number of discrete
options, a quantifiable outcome (did it authorize? what did it cost?), and inputs that can be
faithfully simulated without going near real cardholder data or a real PSP connection.

This is a claim from TypeSafe/OpenRouter's own marketing, not independent evidence. That's the gap
this project tries to close, one narrow question at a time: **can Jev be a strong alternative to
rule-based decision making for choosing which payment service provider (PSP) handles a
transaction's first attempt?**

## 2. What I tested — written down before running anything

Before writing a line of simulator code, I committed five hypotheses, so nothing below could be
quietly fitted to a result I'd already seen:

| | Hypothesis |
|---|---|
| **H1** | Jev responds correctly to the data it's given — when one PSP's metric improves and everything else is held fixed, its probability for that PSP rises sensibly. |
| **H2** | On stable, boring traffic, Jev roughly matches a well-tuned rule set. |
| **H3** | When rules go stale (a PSP quietly degrades) or data is thin (cold start, rare segments), Jev does *better* than static rules. |
| **H4** | Jev loses to rules on latency, cost per decision, determinism, and auditability. |
| **H5** | Jev is mostly but not perfectly consistent — repeated calls and harmless input changes sometimes change its choice. |

I wrote down my own honest expectation at the time, too: *"The most likely honest result is
'competitive where rules are stale or data is thin, not better than a tuned rule elsewhere.'"*
Keep that in mind — it matters later, because the real result was more pessimistic about Jev than
even that.

## 3. How the test works

I built a seeded simulator with three synthetic PSPs (closely clustered, realistic 92–94.5%
base acceptance rates) and generated 1,000-transaction streams per scenario. The single most
important design choice: **every router sees the same imperfect, noisy view of PSP performance —
never the ground truth.** There's a hidden "world" (the true acceptance probabilities, including
drift and segment effects) and an "observed" view (a noisy, slightly stale rolling summary
computed from background history) — only the observed view ever reaches a router. If routers saw
the true numbers directly, a lookup table would win by definition; the gap between world and
observed is what makes "which router reasons better under uncertainty" a real question.

I compared four routers across 6 scenarios (stable traffic, a PSP silently drifting worse
mid-stream, thin data for one segment, a cold-start PSP, conflicting cost/acceptance objectives,
and a shifting eligibility mix):

- **R0** — naive floor, always picks the same PSP. Beating this proves nothing.
- **R1** — hand-tuned rules, the kind a payments team would plausibly write from PSP contracts.
- **R2** — the same rule structure as R1, but every parameter chosen by grid search and frozen.
  **This is the real baseline** — beating R0 or R1 proves nothing; the claim only means something
  against the best a conventional rules engine could plausibly do with the same information.
- **R3 — Jev.** Gets the exact same eligible-PSP set and observed view as every other router,
  nothing more.

Jev receives a "Decision Contract": the transaction context, each eligible PSP's exact fee and
noisy observed stats (with sample sizes attached), a plain-language objective ("choose the PSP
most likely to authorize; if two are comparable, prefer the cheaper one"), and a full glossary
defining every field — it's never expected to infer payments jargon. It never sees the hidden
world values, scenario names, or anything else about the experiment.

Full detail, including a methodological correction I made to R2's tuning (a first attempt
overfit badly to a single tuning stream and I fixed it by pooling 5), is in the repo's
`EXPERIMENT.md`.

## 4. Results

**The probes came first**, before the big expensive batch, as cheap sanity checks on single
decisions:

- **Responsiveness** (tests H1): sweeping one PSP's acceptance rate against a fixed competitor
  produced a clean, monotonic curve — near-zero selection probability until it crosses the
  competitor's value, then a sharp flip to ~100%, with a sensible fee-based tiebreak right at the
  crossover. Jev reasons about acceptance exactly the way you'd want.
- **Irrelevance** (tests H5): five harmless reshufflings of the same decision (PSP order, field
  order, an added unrelated field) — 15 of 15 calls kept the same choice.
- **Repeatability** (tests H5): the identical request, called live 20 times — the choice never
  changed, but stated confidence drifted in a narrow band (0.92–0.95). Consistent with
  OpenRouter's own documentation, which shows the same input returning slightly different
  confidence values across repeat calls.
- **Trade-off** (also tests H1, and this is the one that foreshadows everything below): two PSPs,
  one with 1 point higher acceptance and a *much* higher fee. Jev picked the higher-acceptance,
  pricier option in **10 out of 10 calls**, at both a small and a large transaction amount. No
  lean toward the cheaper option showed up, even on a €10 payment.

**Then the real batch**: 6 scenarios × 20 seeds × 700 test-slice decisions, ~84,000 live calls,
every rate reported with a 95% bootstrap confidence interval.

| Scenario | R2 (the real baseline) | Jev | Gap | Significant? |
|---|---|---|---|---|
| Stable | 94.06% | 93.36% | 0.70pp | borderline |
| Drift | 93.83% | 93.06% | 0.77pp | borderline |
| Thin data | 94.29% | 93.14% | **1.15pp** | **yes** |
| Cold start | 94.31% | 93.34% | 0.97pp | **yes** |
| Conflicting objectives | 95.93% | 94.57% | **1.36pp** | **yes** |
| Eligibility mix | 93.99% | 92.79% | 1.20pp | **yes** |

**R2 beat Jev's authorization rate in all six scenarios**, significantly in four. And the scenario
where Jev should have had its best shot — thin data and cold start, exactly where a rigid rule
set should be at its weakest — is where the gap was *larger*, not smaller.

I also ran nine deliberate perturbations to the simulated world (halving/doubling hidden segment
effects, different drift sizes, different observed-data lag and window settings) as a
robustness check. **None of them flipped the result.** R2 won every variant, by 0.26 to 1.43
percentage points depending on the setting.

One genuine point in Jev's favor: on **net cost** (fee plus chargeback loss, only when
authorized), Jev was actually *cheaper* than R2 in four of the six scenarios. It just authorizes
less often — the one metric the project's own rules say should dominate when the two trade off.

## 5. What Jev did well, and where it failed — a concrete example

Jev isn't incoherent. Here's a real disagreement from the Playground, conflicting-objectives
scenario, a €13.73 SEPA debit transaction in France, choosing between two eligible PSPs:

- **PSP Beta**: 96.0% observed overall acceptance, expected fee €0.351
- **PSP Gamma**: 90.7% observed overall acceptance, expected fee €0.274 (22% cheaper)

Both PSPs' segment-specific acceptance happened to be an uninformative 100%-on-2-samples tie, so
the real signal here is overall acceptance (favors Beta) versus fee (favors Gamma, clearly). R1
and R2 both picked **Gamma** — the cheaper option, since the acceptance gap isn't large enough to
be worth paying 22% more. **Jev picked Beta, assigning it 85% probability** — and in this specific
simulated transaction, both PSPs would have authorized anyway, so Jev's choice simply cost more
for no benefit.

This is the pattern underneath the whole result: Jev weights a PSP's likelihood of approving a
payment *far* more heavily than the fee it charges, even though its own stated objective
explicitly says to use fee as the tiebreaker in close calls. A rule can be written to do that with
surgical precision. Jev, as tested here, didn't reliably follow the instruction. It even shows up
in a strange-looking "calibration" result: because almost every PSP in this world authorizes most
of the time anyway, the transactions where Jev states *low* confidence are disproportionately the
ones where it's hedging on the cheap PSP — which then goes on to be the actual best choice once
you account for near-universal authorization. Two independent probes point at the same underlying
behavior from different angles, which is why I trust this is a real finding and not a fluke.

## 6. Cost, latency, and auditability — the production reality check

Beyond the headline number, every other axis that matters for running this in production also
favors rules:

- **Latency**: Jev added roughly 270–285ms per decision on average (worst case over 3 seconds
  observed) against a rule's effectively-zero evaluation time.
- **Cost**: a small but nonzero amount per call, against zero marginal cost for a rule. The full
  ~172,000-call experiment (pilot, probes, main batch, data-richness runs, sensitivity checks)
  cost roughly $10–11 total — cheap for an experiment, not free at payment-processing volume.
- **Determinism**: confirmed imperfect. OpenRouter's own docs show this (same input, different
  confidence across calls), and my repeatability probe reproduced it directly.
- **Auditability**: more nuanced than a flat loss. Every Jev decision comes with a full
  probability distribution, a stated confidence, and the exact request/response — considerably
  more introspectable than "the model said so." But it's still not traceable to a specific,
  human-written rule the way a rules engine's decision is, which matters for regulated-industry
  audit requirements this project doesn't attempt to adjudicate.

## 7. What it would take to actually use something like this

Even setting the results aside, using a model like Jev for live payment routing would require, at
minimum: hard eligibility and safety rules enforced in code — never delegated to the model — a
deterministic fallback path for invalid or failed model responses (this project builds and
exercises exactly that), monitoring for behavioral drift over time, full request/response logging
for audit, a clear latency and cost budget at real transaction volume, and a plan for
re-validating the whole comparison every time the pinned model version changes. None of that is a
reason not to test the idea. It's the difference between running an honest experiment and
shipping something.

## 8. Limits of this study

- This doesn't prove Jev improves or fails to improve *real* payment routing — only that it
  didn't win in this synthetic simulation, under these specific design choices.
- The simulated world is synthetic by construction; the sensitivity check is my attempt to show
  the conclusion isn't fragile to that, but it can't rule out every possible world design.
- Observed data comes from background history independent of routing choices — exploration and
  feedback loops aren't tested at all.
- Only one decision type (first-attempt PSP selection) is tested. Retries, 3DS, fallback cascades:
  explicitly out of scope.
- One pinned model version (`typesafe/jev-1.13`), one point in time (October 2026). The model
  could change.
- I tested one phrasing of the objective and one decision schema. Whether a stronger emphasis on
  cost in the wording would change Jev's acceptance-over-cost behavior is a reasonable next
  experiment, not something this one rules out.

## 9. The honest bottom line

No — in this experiment, Jev is not a strong alternative to a well-tuned rule-based router for
this decision. It loses on authorization rate in every scenario I tested, significantly in most,
and that holds up under nine different ways of stress-testing the simulated world. It specifically
fails to show the one advantage — handling staleness or thin data better than static rules — that
would have made the strongest case for using it. It's also slower, costs more, and is less
deterministic than the rules it's up against.

That's not the same as saying it's broken. It responds sensibly and predictably to the data it's
given, stays consistent under changes that shouldn't matter, and disagrees with the rule engine on
roughly half of all decisions in ways that are explainable, not random — it's doing real,
independent reasoning. It just reliably underweights cost relative to acceptance, in a way a rule
doesn't.

Full methodology, every hypothesis verdict, every number, and the two implementation bugs I caught
and fixed before trusting any result: [link to `EXPERIMENT.md` in the repo]. Try it yourself —
replay any of the scenarios above for free, or send your own transaction to the live model — on
the [Playground and Results page].

*This project never processed, authorized, or routed a real payment, and never connected to a
real PSP, bank, or card network. Every PSP here is simulated.*
