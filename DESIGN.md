# Playground Page — UX Brief

## What we're asking for

The Playground page works, but it was built by an engineer proving out a concept, not designed
for a person. We'd like your help turning it into an experience that's **clear, delightful,
informative, and easy to use and understand** — for someone who has never read a word about this
project before they land on it. Everything below is context to get you there: who's using it,
what they're trying to do, how the experience feels today, and where it currently gets in its own
way. The implementation details at the end are there so you know what's technically load-bearing
and what's just how it happened to get built — treat layout, color, and component choices as
completely open, not as constraints.

## What this thing is, in one paragraph

Payment companies route each transaction to one of several payment processors, and that choice is
almost always made by a hand-written rules engine. This project tested whether an AI decision
model ("Jev") could make that choice as well as — or better than — tuned rules. It didn't, in this
test, and that honest result lives on a separate "Results" page. The **Playground** is the hands-on
companion to that finding: pick a transaction, watch three different routers (two rule-based, one
AI) look at the same data and make their pick, and see what would have happened. It's a toy you
can poke at to build your own intuition about *why* the AI made the choice it did — not a sales
pitch for either side.

## Who's using it, and what they came to do

Two kinds of visitor arrive here, and the page doesn't currently tell them apart:

1. **The skeptical-curious reader.** They read a Results page, a report, or a post about this
   project, and they want to *see it for themselves* — pick a scenario, watch the disagreement
   happen, maybe peek at the raw data to convince themselves it's not smoke and mirrors. They
   likely know a bit of the vocabulary already (acceptance rate, chargeback, PSP) but shouldn't be
   required to.
2. **The cold arrival.** Someone shared a link, or they found this through search, with zero
   context. They don't know what a "router" is in this context, don't know the three letters
   "PSP," and don't know why there are two modes or what "R1/R2/Jev" means. Right now the page
   assumes they'll figure it out from inline one-liners; there's no welcoming on-ramp.

Both groups share one underlying need: **understand a decision, and trust that what they're
looking at is real** (a real transaction, a real or faithfully-replayed AI response), not a demo
faked for effect. The "no real payments happen here" safety message already does some of that
trust-building work, but it's the only trust signal on the page — everything else about "is this
real data" is buried in raw JSON most people will never open.

## The experience today, walked through

A first-time visitor lands on the Playground and immediately sees a fully-populated result: a
specific transaction, three router choices already made, a confidence score, an amber box
announcing "Jev and R2 disagree," plaintext probabilities, outcome cards, and — below all of
that — three panels of raw JSON in a terminal font. Nothing asked them a question first; nothing
explained what they're looking at before showing them the answer. It's a lot, all at once, with
equal visual weight given to the headline result (which PSP won) and the deep technical evidence
(the literal API payload).

If they switch to "Custom inputs" to try their own numbers, they're faced with roughly 28
individual input fields across a transaction form and three PSP cards, each field a bare label
over a number box, with no sense of which few things actually matter versus which are there for
completeness. They click "Simulate," wait somewhere under a second (a real network call to a
hosted AI model happens here — the one moment of real latency on the whole page), and get back
the same dense result view.

There's a row of five small pill-shaped labels near the top of the result ("1. Transaction,"
"2. Rules," "3. Jev," "4. Route," "5. Simulated outcome") meant to show the pipeline the decision
went through, but it reads as a status indicator, not something that helps a visitor *understand*
the process — there's no sense of data actually flowing from one stage to the next, nothing that
would help someone grasp "the rules and the AI see the exact same input and still disagree," which
is arguably the single most important idea on the whole page.

## What this page most needs to communicate (regardless of layout)

- **The core "aha": two routers, same inputs, different answers — and here's why.** This is the
  entire point of the Playground and currently gets the same visual treatment as every other
  fact on the page.
- **What's real versus simulated**, without requiring a visitor to read raw JSON to believe it.
  The Jev choice (in custom mode) is a genuine live model response; the authorization outcome
  shown afterward is always a local simulated coin-flip, never something Jev or the real world
  decided. That distinction currently has no visual language at all — both look equally "real."
- **A sense of stakes and scale** — this is modeling a decision that, at real payment-processing
  volume, moves meaningful money, even though nothing here is a real transaction.
- **Enough plain-language grounding that nobody needs to already know what a PSP, acceptance rate,
  or chargeback is** before they can follow what's happening.
- **An invitation to explore**, not just a finished answer. Changing one number and seeing the
  decision flip is the most compelling thing this page can do, and today nothing nudges a visitor
  toward trying that.
- **A path for the technical reader** who does want the raw request/response/schema, without that
  material competing for attention with everyone else's experience.

## Things the redesign needs to keep working

- A **preset mode** (instant, free, replays one of 6 scenarios × 2 worked examples) and a
  **custom mode** (the visitor's own numbers, a real paid/rate-limited call to the live model) —
  both need to stay clearly distinguishable, since one costs real money and is rate-limited and
  the other doesn't.
- The **safety framing** ("simulation only, no real payment is ever processed") has to stay
  prominent — it's a hard requirement of the project, not a style choice.
- Access to the **raw technical evidence** (the exact request sent to the model, its raw response,
  the schema) must remain available to whoever wants it, even if it's no longer front-and-center.
- The **router/scenario vocabulary** (R1, R2, Jev/R3; the six scenario names) is fixed by the
  underlying experiment and needs explaining, not renaming, so it stays consistent with the
  project's report and Results page.
- Custom mode's real network call (currently ~270–300ms typical, occasionally much slower) is the
  one place a loading state matters; everything else on the page is instant.

## Current look and feel (so you know the starting point — not a constraint)

Dark theme only, flat design with no shadows (depth comes from border + translucent fill
layering), Tailwind's default system font at small sizes (mostly 12–14px text), no icon set, no
illustration, no logomark — the brand is a text wordmark. Primary accent is indigo (used for the
active mode toggle, the stepper's current step, and the submit button); amber marks both
"disagreement" and, confusingly, also reads as a generic warning color; green/red mark
authorized/declined outcomes. Full color values, component-by-component layout, and exact copy are
in the appendix below if useful for grounding, but none of it should be treated as a design
direction to preserve.

## A few specific moments worth designing well

- The instant a visitor realizes **the AI and the rule engine looked at the same data and picked
  differently** — right now this is an amber box with bold PSP names; it could be the single most
  memorable moment on the page.
- **Changing one slider/field in custom mode and watching the decision potentially flip** — this
  doesn't exist as a guided moment at all today; everything is submit-and-wait, nothing is "live"
  or exploratory.
- **The gap between "Jev sounds confident" and "Jev was actually right"** is a real, documented,
  slightly counterintuitive finding from the underlying experiment (see the Results page's
  calibration chart) — if there's room for one piece of the "why this matters" story to land on
  the Playground itself, this is a strong candidate.

---

## Appendix: current implementation, for technical grounding

*(Everything below is "what's there today," not a spec to preserve. Use it to understand
constraints — what data is actually available, what's technically free versus a live paid call —
not as a layout to keep.)*

**Source files:** `components/PlaygroundClient.tsx` (548 lines, all client-side page logic),
`app/layout.tsx` (shared header/footer/safety banner across every page), `app/globals.css`.
Tailwind CSS v4 utility classes only; no component library.

**Page structure, top to bottom:** sticky safety banner → header (wordmark + Playground/Results
nav links) → page title + intro line → preset/custom mode toggle → a status pill restating the
current mode → mode-specific controls (two dropdowns + a scenario description in preset mode; a
~28-field form in custom mode) → an error banner (conditional) → a 5-step pill-badge "flow
diagram" (current step highlighted; pulses during a real live call) → a 3-column plain-language
legend for R1/R2/Jev → a row of 4 cards (R1's pick, R2's pick, Jev's pick, Jev's confidence
number) → a conditional amber "they disagreed" callout → Jev's stated probability per PSP as plain
text → one outcome card per distinct PSP chosen (authorized/declined + net cost in EUR) → up to 3
side-by-side raw-JSON panels (Decision Schema, sanitized request, raw response) each with a copy
button.

**Data reality check:** in custom mode, the PSP *choice* from Jev is a genuine live API response
(cached by exact request hash). The *authorization outcome* shown afterward (did it get approved,
what did it cost) is always a local `Math.random()` draw against the PSP's configured acceptance
rate — it never comes from Jev or anywhere external, in either mode. Preset mode's Jev choice is a
real response that was recorded during the project's original experiment and is being replayed,
not a fresh call.

**Known friction points already identified (feel free to validate or override):**
- No onboarding moment — the page loads straight into a fully-populated result.
- The "flow diagram" is five static pill labels, not a spatial/visual pipeline.
- Raw JSON panels are terminal-styled and compete visually with the human-readable summary above
  them.
- Custom mode's ~28 input fields have no visual hierarchy — a sample size field looks as important
  as the acceptance rate that actually drives the decision.
- Amber is overloaded (disagreement vs. generic warning).
- No distinction, visually, between "this came from a live model" and "this is a simulated coin
  flip."
- Color palette: page background `#1a1a19`; primary text near-white; indigo for primary
  actions/active states; amber for disagreement/highlight; emerald/red for
  authorized/declined; near-black terminal panels with green monospace text for raw JSON.
- Responsive breakpoints are Tailwind defaults (`sm` 640px, `lg` 1024px); the 3-PSP custom form
  stays single-column until 1024px, so it's cramped on most tablets.

Full literal component-by-component spec (every class name, every copy string, every breakpoint)
is available on request if a 1:1 current-state reference is needed — this brief intentionally
leads with the experience and leaves pixel-level detail out so it doesn't anchor the redesign.

## Appendix B: the real custom-mode field list, with mechanical impact

Exact fields, types, and ranges from `lib/playground/schema.ts`, cross-checked against
`lib/routers/ruleRouter.ts`, `lib/domain/eligibility.ts`, and `lib/playground/customDecision.ts` so
"impact" below is verified, not guessed.

### Transaction fields (one set, shared by all 3 PSPs)

| Field | Control | Options / range | Default | Mechanical impact |
|---|---|---|---|---|
| Amount | number | > 0, ≤ 1,000,000 | 60 | **High.** Crosses R1/R2's large (≥500) / small (<500) thresholds, which pick a different rule branch entirely; also scales every PSP's variable fee. |
| Currency | select | EUR / GBP / USD | EUR | **High.** A PSP that doesn't support the chosen currency is dropped from the eligible set entirely (hard rule); `USD` alone also triggers one of R1/R2's named rules. |
| Country | select | DE / NL / FR / UK / US | DE | **Conditional.** Only matters in the specific combination currency=EUR + payment method=card + country ∈ {DE, NL, FR} — that combination triggers R1/R2's "preferred EU-card PSP" rule. Outside that combination, country does nothing. |
| Payment method | select | card / paypal / sepa_debit | card | **High.** A PSP that doesn't support the chosen method is dropped from the eligible set entirely; also part of the EU-card rule combination above. |
| Card scheme | select (only shown if method = card) | visa / mastercard / amex | visa | **None currently.** Not read by eligibility or either rule router. Sent to Jev as context only. |
| Device | select | desktop / mobile | desktop | **None currently** in custom mode specifically — see note below. |
| Customer type | select | new / returning | returning | **None currently** in custom mode — see note below. |
| 3DS eligible | checkbox | — | off | **None currently** in custom mode — see note below. |

### Per-PSP fields (×3 fixed PSPs — `alpha`, `beta`, `gamma`; each gets the identical field set)

| Field | Control | Range | Defaults (alpha / beta / gamma) | Mechanical impact |
|---|---|---|---|---|
| enabled | checkbox | — | all true | **Absolute.** Unchecked = hard-removed from the eligible set, same as an unsupported currency/method. |
| Acceptance rate | number | 0–1, step 0.001 | 0.945 / 0.93 / 0.92 | **High.** The deciding factor for R1/R2 whenever a rule falls through to "pick the highest-acceptance eligible PSP," and R1/R2's safety-fallback check. Per the project's own findings, it's also the signal Jev weighs most heavily. |
| Cost % | number | 0–10, step 0.1 | 1.3 / 1.1 / 0.9 | **High (combined with Fixed fee).** Multiplied by amount to get the variable part of the fee; feeds the "expected fee" Jev is explicitly told to use as a tiebreaker. |
| Fixed fee | number | 0–100, step 0.01 | 0.25 / 0.2 / 0.15 | **High.** Alone decides R1/R2's "cheapest PSP" rule for small transactions (amount < 25); combines with Cost % into every fee shown to Jev. |
| Chargeback rate | number | 0–1, step 0.0001 | 0.0018 / 0.0021 / 0.0015 | **None on the choice.** Never read by either rule router or by Jev's decision logic — only feeds the simulated net-cost number shown *after* a choice is made, and only if a chargeback actually occurs. |
| Availability | number | 0–1, step 0.001 | 0.999 / 0.998 / 0.9995 | **Low/trip-wire.** Only checked once, for whichever PSP a rule already preferred, against a fixed 0.99 safety threshold — a graded value under that line does nothing extra, it's pass/fail. |
| Latency (ms) | number | 1–10,000 | 420 / 290 / 250 | **None on the choice.** Only affects the simulated latency number shown in the outcome card. |
| Sample size | number (int) | 0–1,000,000 | 150 / 150 / 150 | **None on the choice.** Sent to Jev only as a "how much to trust this rate" qualifier alongside each rate field; not used by R1/R2 at all. |

Not currently exposed as editable fields at all, despite being part of the underlying data model
(`supportedCurrencies`, `supportedPaymentMethods` per PSP) — each PSP has a fixed list baked into
the page's defaults (e.g. gamma doesn't support `paypal`), which does affect eligibility, but a
visitor can't currently change it.

**Important nuance for whichever fields end up in a "more details" tier:** in **custom mode**,
card scheme / device / customer type / 3DS-eligible genuinely do nothing to the outcome. Two
separate reasons stack up:

1. **Neither rule router reads them at all.** `ruleRouter.ts`'s rule logic branches only on
   `currency`, `paymentMethod`, `country`, and `amount` — `customerType`/`device`/`cardScheme`/
   `threeDsEligible` never appear in that function. Same for the hard eligibility check (only
   `enabled`, `supportedCurrencies`, `supportedPaymentMethods` matter there). Changing "Customer:
   new → returning" produces byte-identical R1/R2 behavior.
2. **The one number that's supposed to vary by segment doesn't, in custom mode.** Real segment
   data (e.g. "this PSP does better specifically for EUR card payments from new customers in
   Germany") only exists because the underlying experiment has real recorded history to filter by
   segment. Custom mode has no such history, so `customDecision.ts`'s `buildObservedStats` just
   copies the single "Acceptance rate" number you typed into *both* the overall and the
   segment-specific fields: `acceptanceSegment: { value: input.acceptanceRate, ... }`. Jev does
   still receive `customer_type` as a literal text field in the request — it isn't stripped out —
   but every number sitting next to it is identical no matter what that field says. Whether Jev's
   output could still shift from the bare text alone, with every number held constant, is untested
   (no probe isolated this specifically), so the honest claim is "doesn't change any of the
   underlying data," not "guaranteed to produce an identical answer."

They only start to matter in **preset mode**, where the underlying experiment's recorded data does
have a real overall-vs-segment difference. If a collapsed "more transaction details" group is
still the right call for progressive disclosure, it would be honest to either label it as "doesn't
change this result" in custom mode, or treat it as pure flavor/realism rather than implying it's a
lever.

### Why the "Decision Schema" panel used to only appear in preset mode

*(Fixed — kept here as a note on why the two modes were ever inconsistent, in case the same class
of gap shows up elsewhere.)* It was never a deliberate "custom mode gets less transparency"
choice — it was a data-plumbing gap. `decideWithJev` (the function both modes call) always built a
schema object internally (`buildDecisionSchema(args.eligible)`), identical in shape either way,
same `psp_selection` choice question, same metric glossary — but its return type only carried
back `request` and `rawResponse`, never the standalone schema object, so custom mode's UI had
nothing to show and hardcoded `schema={null}`. Preset mode only had one because the separate
script that generated `preset-examples.json` called `buildDecisionSchema` itself and saved it
independently. `decideWithJev` now returns `schema` on every result (ok/invalid/failed alike), and
`PlaygroundClient.tsx` passes it straight through — both modes show the same panel now.

**Recommendation, with the mechanics above as backing:** the fields that actually move the
decision are Amount, Currency, Payment method (jointly: eligibility + which rule fires), and, per
PSP, Acceptance rate and the two fee fields (Cost % + Fixed fee). Country matters only in one
specific combination, so it's a judgment call whether it belongs in the always-visible tier or a
"details" tier with a hint explaining when it matters. Availability is worth surfacing somewhere
visible-but-secondary since it's a real (if binary) safety trip-wire, not just flavor. Chargeback
rate, Latency, Sample size, Card scheme, Device, Customer type, and 3DS-eligible are legitimate
candidates for a collapsed/advanced tier — they're either purely cosmetic to the outcome shown, or
(for the last four) currently inert in custom mode specifically.
