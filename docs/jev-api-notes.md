# Jev / Decisions API notes

Checked 2026-10-11, per section 18 ("Verify Before Coding"), before writing the Jev adapter
(build step 3). Each item is labeled by how it was sourced:

- **Primary** — fetched directly from an official openrouter.ai or typesafe.ai page.
- **Secondary** — came from third-party aggregator/summary sites via search, not confirmed
  against an official page. Treat as a planning estimate, not a guarantee.
- **Empirical** — not documented anywhere found; must be observed directly once we call the
  real API (naturally covered by the C4 pilot run).

## 1. Request format — Primary

Through OpenRouter (which is what section 8.1 specifies — not TypeSafe's API directly):

```
POST https://openrouter.ai/api/alpha/decisions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json

{
  "model": "typesafe/jev-1.13",
  "state": <string | JSON object | array of strings>,
  "questions": {
    "<question_id>": {
      "type": "choice",
      "instructions": "<decision guidance text>",
      "criteria": {
        "<option_id>": "<description of when this option applies>",
        ...
      }
    }
  }
}
```

- `criteria` maps option id → description; max 255 options (we need 3, or fewer with partial
  eligibility — well within range).
- Two other question types exist (`noul` for yes/no, `score` for an ordered scale) — not used
  in v1, only `choice`.
- Multiple questions can be sent in one request; Jev evaluates them independently in parallel
  against the same state, as one round trip. Not needed in v1 (one decision per call), but
  worth knowing for later (3DS/retry decisions could reuse this instead of a second call).
- The note's own URL path says `/api/alpha/decisions` — "alpha" signals this is an early
  surface at OpenRouter and could change before we ship. Worth re-checking right before the
  live pilot (C4), not just now.
- TypeSafe's own native endpoint (confirmed via their OpenAPI spec) is `POST /v1/systemone`
  with `HTTPBearer` auth and the same field names (`state`, `model`, `questions`) — consistent
  with the OpenRouter tutorial, cross-validated from an independent source. We go through
  OpenRouter per section 8.1, not this endpoint directly.
- An official SDK exists (`@openrouter/sdk@1.3.17`). Build decision for step 3: plan to use
  plain `fetch` + Zod response validation rather than add the SDK dependency, for the usual
  reason (no dependency we don't need) — open to revisiting if the SDK meaningfully simplifies
  auth/retry handling once we're actually writing the adapter.

## 2. Response format — Primary

```json
{
  "model": "typesafe/jev-1.13-[date]",
  "answers": {
    "<question_id>": {
      "type": "choice",
      "choice": "<winning option id>",
      "probabilities": { "<option_id>": 0.95, ... },
      "confidence": 0.92
    }
  },
  "usage": { "input_tokens": 492, "output_tokens": 38, "cost": 0.000020664 },
  "id": "gen-dec-[timestamp-id]",
  "provider": "TypeSafe"
}
```

- `confidence` is returned for `choice` answers (0 to 1). Both OpenRouter's and TypeSafe's own
  docs are explicit that confidence reflects "the shape of the probabilities," not correctness,
  and that calibration is a property of many answers on average, never a guarantee for one
  answer. This directly matches section 8.5.4's "do not present probabilities as calibrated" —
  the requirements doc's caution was already correctly anticipating this.
- `usage.cost` is returned per call — we should log it directly rather than compute cost
  ourselves from token counts (section 13's "do not hardcode pricing" extends naturally to
  this: read the API's own reported cost, don't recompute it from a hardcoded rate).

## 3. Pricing — Primary

$0.042 per 1M input tokens, **$0 per 1M output tokens** (Jev's structured output is free, only
the state+question input is billed). At the requirements doc's estimate of ~1,500 tokens/call
and ~180,000 calls: 180,000 × 1,500 × $0.042 / 1,000,000 ≈ **$11.3**, matching the doc's own
ballpark almost exactly. Still want to confirm real input-token size at the C4 pilot, since our
actual state object's size is unknown until we build it.

## 4. Rate limits and timeouts — Secondary (treat as planning estimates)

No official OpenRouter page documents limits specific to the Decisions endpoint. What's
documented:

- OpenRouter's general platform limits (confirmed **primary**, from their own docs) apply only
  to free-tier models; paid models (Jev is paid) have **no OpenRouter platform-level request
  cap**, only Cloudflare's general DDoS protection.
- Third-party sources (not independently confirmed) describe TypeSafe's own backend limits as
  250,000 tokens/second and 1,200 requests/minute per account, returning `429` with a
  `Retry-After` header past that, and a default request timeout of 10.0 seconds.

Net effect: when calling Jev through OpenRouter, the real ceiling is likely TypeSafe's backend
limit, not an OpenRouter-specific one — but since this isn't primary-confirmed, the batch
runner's retry/backoff logic should read and respect `Retry-After` / `429` responses generically
rather than hardcode a specific rpm figure, and we should watch actual throughput during the C4
pilot before trusting these numbers for the full-batch time estimate.

## 5. Context window / state size limits — Primary (top-line) + Secondary (breakdown)

64K token context window (**primary**, from the official model page). A secondary source adds
detail: of the 64K, about 32K is budgeted for state + the longest question combined (roughly
150,000 English characters). Our state (one transaction + up to 3 PSPs' observed stats) will be
a tiny fraction of that — not a concern for v1, but worth keeping in mind if Decision Memory
(out of v1 scope) later adds raw history to the state.

## 6. Determinism — Primary: confirmed NOT fully deterministic

OpenRouter's own blog post documents this directly, with real examples: the same input
returned 0.52 one call and 0.49 another; a separate case showed confidence 0.79 then 0.84 on
repeat. Their own guidance: "set threshold values on bands rather than exact values." This
directly validates H5 as stated (mostly but not perfectly consistent) and confirms the
repeatability probe (9.3) is testing something real, not a formality. It also confirms why
fixtures must replay the exact recorded response bytes rather than re-deriving them — a replayed
fixture is deterministic by construction, but a fresh live call to the same state is not
guaranteed to match it exactly.

## 7. Is `typesafe/jev-1.13` still current — Primary: yes

Live and listed on OpenRouter today (2026-10-11), priced, released 2026-09-18. No indication of
deprecation or a newer pinned point-release superseding it.

## 8. Terms of use for publishing results — Primary: no restriction found

Checked both:
- **OpenRouter's main Terms of Service**: no general restriction on publishing benchmark or
  performance comparisons. There *is* a restriction, but it's scoped to OpenRouter's "Stealth
  Program" (models kept confidential pre-launch) via a separate Stealth Program EULA — Jev is
  not a stealth model (it's publicly documented, blogged about, and priced), so this doesn't
  apply to us. (A search engine's synthesized summary initially conflated these two things and
  suggested a general publishing ban; fetching the actual ToS page directly showed that's
  wrong — worth flagging since it would have been a real blocker if true.)
- **TypeSafe's Terms of Use** (last updated 2026-09-19): no clause restricting publication of
  benchmark or comparative test results either.

## Summary: anything that changes an assumption in requirements.md?

No assumption in the requirements doc needs to change. Section 8 (Jev Decision Contract) and
section 9.2's cost estimate both hold up well against the real API. The one thing worth noting
operationally: rate-limit numbers are secondary-sourced only, so the batch runner (section
19.3's "parallel requests, retries, and resumable progress") should be defensive about
`429`/`Retry-After` rather than tuned to a specific assumed rpm figure.
