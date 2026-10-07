# Hypotheses

Committed 2026-10-07, before the first experiment run. Results in the Medium post and
Results page are reported against these, whatever the outcome.

| ID | Hypothesis |
|---|---|
| H1 | Jev responds correctly to the data it is given: when one PSP's metric improves and everything else is fixed, its probability for that PSP rises sensibly. |
| H2 | On stable traffic, Jev roughly matches a well-tuned rule set. |
| H3 | When rules go stale (a PSP degrades mid-stream) or data is thin (cold start, rare segments), Jev does better than static rules. |
| H4 | Jev loses to rules on decision latency, cost per decision, determinism and auditability. |
| H5 | Jev's output is mostly but not perfectly consistent: repeated calls and harmless input changes (PSP order, field order) sometimes change the choice. |

The most likely honest result is "competitive where rules are stale or data is thin, not
better than a tuned rule elsewhere". That is a useful finding, and the project should be
comfortable reporting it.
