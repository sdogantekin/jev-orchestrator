# Payment Decision Lab

A simulation-only experiment testing one question:

> Can Jev, a probabilistic decision model from TypeSafe, be a strong alternative to
> rule-based decision making in payment orchestration?

The idea started from a public claim that Jev is weak at content generation like typical LLMs
but very good at decisions based on a given data set — **claimed by TypeSafe/OpenRouter, tested
here.** See [`docs/hypotheses.md`](docs/hypotheses.md) for the five hypotheses committed before
the first run, and the Results page for how each one held up.

## This app never touches real payments

- It never processes, authorizes, captures, refunds, routes, or executes a real payment.
- It never connects to a real PSP, merchant account, card network, bank, or acquirer.
- PSPs (`PSP Alpha`, `PSP Beta`, `PSP Gamma`) are entirely simulated. Nothing implies a live
  integration.
- No real PAN, CVV, token, bank account, cardholder data, or production transaction data is
  accepted or stored anywhere.
- All results, fees, latency, retries, declines, and chargebacks come from the simulator.

## What's here

- **The experiment**: a seeded simulator (`lib/simulation/`) and four routers — R0 (naive), R1
  (hand-tuned rules), R2 (grid-search–tuned rules), R3 (Jev) — compared across 6 scenarios, with
  probes, a data-richness comparison, and a sensitivity check. Batch scripts live in
  `experiments/scripts/`; results in `experiments/results/`.
- **The Playground**: pick a preset scenario example (free, instant, replays a real recorded
  decision) or craft your own transaction and PSP stats (makes a real, rate-limited live call to
  Jev).
- **The Results page**: the precomputed findings as charts and tables, each linked to the
  hypothesis it tests.

## Running locally

```bash
npm install
npm test          # unit tests (no network access, no live Jev calls)
npm run dev        # the web app at http://localhost:3000
npm run build      # production build
```

Copy `.env.example` to `.env` and fill in `OPENROUTER_API_KEY` to use the Playground's live
"custom inputs" mode. Everything else in the app — the Results page, the Playground's preset
examples, and the whole test suite — works without any key, since all of that replays committed,
real recorded data.

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are optional: without them, the
Playground's rate limiting falls back to an in-memory counter, which is fine for local dev but
not for a real deployment (resets on restart, not shared across instances).

### Reproducing the experiment

The batch scripts under `experiments/scripts/` are what generated everything in
`experiments/results/`. They make real, billed calls to Jev (the pilot and main comparison alone
cost a few dollars total) and are not something to run casually:

```bash
npm run pilot           # one scenario, one seed — sanity check before anything bigger
npm run probes          # the 4 live probes (calibration is derived separately, for free)
npm run jev-main-batch  # the full 6-scenario x 20-seed comparison
npm run data-richness   # levels 1-3 on stable and drift
npm run sensitivity     # 9 world-design variants on stable
```

Every live Jev response is cached locally by state hash and recorded as a fixture under
`experiments/fixtures/` (gitignored — not committed, see `docs/assumptions.md` #11), so rerunning
any script only pays for states it hasn't already seen.

## Limitations

- This project does not prove that Jev improves real-world payment routing.
- The simulator is synthetic; conclusions depend on how the world was designed (see the
  sensitivity check on the Results page for how much that matters here).
- Observed data comes from a background history independent of routing choices, so exploration
  and feedback loops are not tested.
- Only one decision type — PSP selection for a first attempt — is tested.
- Results apply to one model version (`typesafe/jev-1.13`, pinned) at one point in time
  (October 2026).
- The sensitivity check uses 5 seeds on one scenario, fewer than the main results, to keep the
  number of paid Jev calls bounded.
- Jev's probabilities are model outputs, not guarantees or calibrated odds — see the
  calibration finding on the Results page.
- Currency conversion uses fixed simulation constants, not market rates.
- A real payment router needs far more data, controls, monitoring, resilience, compliance
  review, and domain optimization than anything here.

See `docs/assumptions.md` for every implementation judgment call made where the requirements
doc was silent, and `docs/jev-api-notes.md` for what was verified against the live Jev API
before building the adapter.
