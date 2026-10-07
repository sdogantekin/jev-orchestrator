# Assumptions made during implementation

The requirements doc is precise about almost everything, but step 1 (domain + simulator)
required a few concrete choices it leaves open. Recorded here per section 19.3 ("if something
is ambiguous... ask before guessing" — these were judgment calls small enough to make and flag,
not large enough to block on). Flag anything here you want changed.

## 1. Amount generation: bucket-first, then truncated lognormal within the bucket

Section 5.4 asks for a lognormal with median 60 that also hits roughly 25% small (<25) / 60%
medium (25-499.99) / 15% large (>=500). A single untruncated lognormal centered at median 60
cannot hit all three simultaneously: fitting the small/large split exactly forces the other
bucket off by 5+ points (checked numerically — the best single-sigma compromise lands near
30/59/10, not 25/60/15).

Implemented instead: draw the bucket first from the configured weights (exact, by
construction), then sample the amount within that bucket from a lognormal (median 60,
`sigma = 0.5`, configurable in `experiments/config/stream.base.json`) truncated to the bucket's
bounds. This hits the configured bucket proportions exactly and still gives realistic
within-bucket spread. See `lib/simulation/stream.ts`.

## 2. Amount's currency is not modeled; `amountEUR` is a pure reporting conversion

The transaction's `amount` is generated independently of which currency/country was drawn
(a currency-agnostic magnitude), and bucket thresholds (25, 500) apply directly to it. Section
5.3 only mentions EUR conversion "for reporting," so `amountEUR = amount * conversionRate` is
used for fee/cost math and metrics, but amount generation itself does not vary by currency.

## 3. PSP fixed fees and the chargeback fixed fee are EUR-denominated constants

Fee math (`lib/domain/fees.ts`) is computed entirely in EUR: `feeEUR = amountEUR *
transactionCostPercent% + fixedFee`, and chargeback loss is `amountEUR + chargebackFixedFeeEUR`
(default 15). The requirements table doesn't state a currency for the per-PSP fixed fee or the
chargeback fixed fee; EUR was chosen for consistency with "amounts are converted to EUR for
reporting."

## 4. Background history reuses the same common-random-number draws as routing outcomes

Section 5.5 requires observed stats to come from a "background history... independent of
router choices." Rather than adding a second RNG stream, a background attempt for (PSP,
historical transaction i) is computed with the exact same `simulatePspOutcome` call a router
would get if it had picked that PSP for that transaction — same hash key, so it's already
independent of which router (if any) actually chose it. This avoids a second, parallel
randomness source with its own determinism obligations.

## 5. Thin data / cold start are modeled as a capped lifetime history, not a shrunk window

"Beta's observed EUR/DE/card segment is limited to about 25 background attempts" and "Gamma's
observed history limited to 20 attempts overall" read as *lifetime* sample caps, not a change
to the normal lag/window. Implemented as: when a `BackgroundHistoryLimit` matches, widen the
candidate range to the PSP's full history up to `t - lag` (ignoring the window bound) and keep
only the most recent `maxAttempts` eligible attempts. See `gatherBackgroundAttempts` in
`lib/simulation/observedView.ts`.

## 6. Eligibility mix's exact payment-method split

Section 5.6 only says "the stream has 40% PayPal and SEPA Debit, so exclusions happen often,"
without exact numbers. Implemented as `card: 0.60, paypal: 0.267, sepa_debit: 0.133` — card
takes the complement of 40%, and PayPal/SEPA keep the base stream's 2:1 ratio (20:10).

## 7. Retry success rate has no observation model in v1

Retry decisions are out of v1 scope (section 4), so there is no simulated retry attempt to
observe. The PSP's `retrySuccessRate` is passed through from config as an exact value in the
observed view, not estimated with sampling noise like acceptance/availability/chargeback are.

## 8. Scenario overrides are single-axis

Each of the six scenarios (5.6) changes one mechanism (drift, a background-history cap, a
world/stream override). `resolveScenario` supports combining them, but no scenario config
currently does, matching the literal scenario table.
