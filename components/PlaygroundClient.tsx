"use client";

import { useMemo, useState } from "react";
import type { Currency, PaymentMethod, PspId } from "../lib/domain/types";
import type { PspConfig } from "../lib/domain/psp";
import type { ObservedPspStats } from "../lib/simulation/observedView";
import type { PspInput, TransactionInput } from "../lib/playground/schema";
import type { JevOnlyResult } from "../lib/playground/customDecision";
import { minimalPspConfig, resolveCustomState, simulateOnceFromInput, type AmountBucketConfig } from "../lib/playground/liveRouting";
import { describeRuleParams } from "../lib/routers/describeRules";
import { runRuleRouterTraced, type RuleParams } from "../lib/routers/ruleRouter";
import type { RouterInput } from "../lib/routers/types";
import { SCENARIO_DESCRIPTIONS } from "../lib/content/glossary";

const SCENARIO_IDS = ["stable", "drift", "thin_data", "cold_start", "conflicting_objectives", "eligibility_mix"] as const;
type ScenarioId = (typeof SCENARIO_IDS)[number];
const SCENARIO_LABELS: Record<ScenarioId, string> = {
  stable: "Stable",
  drift: "Drift",
  thin_data: "Thin data",
  cold_start: "Cold start",
  conflicting_objectives: "Conflicting objectives",
  eligibility_mix: "Eligibility mix",
};

const PSP_IDS = ["alpha", "beta", "gamma"] as const;
const DISPLAY_NAME: Record<PspId, string> = { alpha: "PSP A", beta: "PSP B", gamma: "PSP C" };

// Palette, lifted from the Playground.dc.html design.
const BG = "#161615";
const CARD_BG = "#1c1c1a";
const TEXT = "#f0efec";
const MUTED1 = "#c9c8c2";
const MUTED2 = "#a3a29c";
const MUTED3 = "#8f8e88";
const INDIGO = "#9aa0ff";
const INDIGO_LT = "#b4b9ff";
const INDIGO_PALE = "#c9ccff";
const INDIGO_DARK = "#14143a";
const PINK = "oklch(0.76 0.15 350)";
const GREEN = "oklch(0.78 0.14 160)";
const RED = "oklch(0.72 0.15 25)";
const TEAL = "oklch(0.82 0.11 200)";

type PresetExample = {
  scenarioId: string;
  transactionIndex: number;
  transaction: Record<string, unknown>;
  eligiblePspIds: string[];
  observed: Record<string, ObservedPspStats>;
  schema: unknown;
  request: { state?: { psps?: Array<{ id: string; fixed_fee_eur: number }> } };
  rawResponse: unknown;
  jevChoice: string;
  jevProbabilities: Record<string, number>;
  jevConfidence?: number;
  r1Choice: string;
  r2Choice: string;
  outcomesByPsp: Record<string, { authorized: boolean; netCostEUR: number; latencyMs: number | null }>;
};

export type PresetExamples = Record<ScenarioId, { disagreement: PresetExample; agreement: PresetExample }>;

const DEFAULT_TRANSACTION: TransactionInput = {
  amount: 60,
  currency: "EUR",
  country: "DE",
  paymentMethod: "card",
  cardScheme: "visa",
  device: "desktop",
  customerType: "returning",
  threeDsEligible: false,
};

const DEFAULT_PSPS: PspInput[] = [
  {
    id: "alpha",
    enabled: true,
    supportedCurrencies: ["EUR", "GBP", "USD"],
    supportedPaymentMethods: ["card", "paypal"],
    transactionCostPercent: 1.3,
    fixedFee: 0.25,
    acceptanceRate: 0.945,
    retrySuccessRate: 0.31,
    chargebackRate: 0.0018,
    latencyMs: 420,
    availabilityRate: 0.999,
    sampleSize: 150,
  },
  {
    id: "beta",
    enabled: true,
    supportedCurrencies: ["EUR", "GBP", "USD"],
    supportedPaymentMethods: ["card", "paypal", "sepa_debit"],
    transactionCostPercent: 1.1,
    fixedFee: 0.2,
    acceptanceRate: 0.93,
    retrySuccessRate: 0.38,
    chargebackRate: 0.0021,
    latencyMs: 290,
    availabilityRate: 0.998,
    sampleSize: 150,
  },
  {
    id: "gamma",
    enabled: true,
    supportedCurrencies: ["EUR", "GBP", "USD"],
    supportedPaymentMethods: ["card", "sepa_debit"],
    transactionCostPercent: 0.9,
    fixedFee: 0.15,
    acceptanceRate: 0.92,
    retrySuccessRate: 0.42,
    chargebackRate: 0.0015,
    latencyMs: 250,
    availabilityRate: 0.9995,
    sampleSize: 150,
  },
];

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ---------- shared render-model types, filled identically whether the data came from a replayed preset or a live custom run ----------

interface RouterCardModel {
  id: string;
  kindLabel: string;
  how: string;
  pickLabel: string;
  why: string;
  color: string;
  tagLabel: string;
  tagFg: string;
  tagBg: string;
  isJev: boolean;
  dim: boolean;
}

interface VerdictModel {
  eyebrow: string;
  title: string;
  body: string;
  color: string;
  border: string;
  bg: string;
}

interface RuleBookRowModel {
  n: number;
  text: string;
  state: string;
  fired: boolean;
  dim: boolean;
}

interface RuleBookModel {
  title: string;
  note: string;
  rows: RuleBookRowModel[];
}

interface OutcomeModel {
  who: string;
  psp: string;
  status: "Approved" | "Declined";
  cost: string;
  color: string;
}

function traceToRows(params: RuleParams, trace: { n: number; fired: boolean }[]): RuleBookRowModel[] {
  const text = describeRuleParams(params);
  const firedOrderedIdx = trace.slice(0, 5).findIndex((r) => r.fired);
  return trace.map((r, i) => {
    let state: string;
    let dim: boolean;
    if (i < 5) {
      state = r.fired ? "MATCHED" : i < firedOrderedIdx ? "skipped" : "not reached";
      dim = !r.fired;
    } else {
      state = r.fired ? "USED" : "not needed";
      dim = !r.fired;
    }
    return { n: r.n, text: text[i] ?? "", state, fired: r.fired, dim };
  });
}

function mkRuleBook(title: string, note: string, params: RuleParams, routerInput: RouterInput): { choice: PspId; book: RuleBookModel } {
  const { choice, trace } = runRuleRouterTraced(params, routerInput);
  return { choice, book: { title, note, rows: traceToRows(params, trace) } };
}

export default function PlaygroundClient({
  presets,
  r1Params,
  r2ParamsByScenario,
  amountConfig,
  conversionRates,
}: {
  presets: PresetExamples;
  r1Params: RuleParams;
  r2ParamsByScenario: Record<ScenarioId, RuleParams>;
  amountConfig: AmountBucketConfig;
  conversionRates: Record<Currency, number>;
}) {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("stable");
  const [exampleType, setExampleType] = useState<"disagreement" | "agreement">("disagreement");

  const [transaction, setTransaction] = useState<TransactionInput>(DEFAULT_TRANSACTION);
  const [psps, setPsps] = useState<PspInput[]>(DEFAULT_PSPS);
  const [moreOpen, setMoreOpen] = useState(false);

  const [jevResult, setJevResult] = useState<JevOnlyResult | null>(null);
  const [jevSnapshot, setJevSnapshot] = useState<{ transaction: TransactionInput; psps: PspInput[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rolls, setRolls] = useState<number[]>([Math.random(), Math.random(), Math.random()]);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawTab, setRawTab] = useState(0);
  const [copied, setCopied] = useState(false);

  async function askJev() {
    if (mode === "preset" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction, psps }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setJevResult(data as JevOnlyResult);
        setJevSnapshot({ transaction, psps });
        setRolls([Math.random(), Math.random(), Math.random()]);
      }
    } catch {
      setError("Jev could not be reached. No AI routing decision was made.");
    } finally {
      setLoading(false);
    }
  }

  function toggleSupportedCurrency(id: string, currency: Currency) {
    setPsps(
      psps.map((p) => {
        if (p.id !== id) return p;
        const has = p.supportedCurrencies.includes(currency);
        if (has && p.supportedCurrencies.length === 1) return p;
        return { ...p, supportedCurrencies: has ? p.supportedCurrencies.filter((c) => c !== currency) : [...p.supportedCurrencies, currency] };
      })
    );
  }

  function toggleSupportedMethod(id: string, method: PaymentMethod) {
    setPsps(
      psps.map((p) => {
        if (p.id !== id) return p;
        const has = p.supportedPaymentMethods.includes(method);
        if (has && p.supportedPaymentMethods.length === 1) return p;
        return { ...p, supportedPaymentMethods: has ? p.supportedPaymentMethods.filter((m) => m !== method) : [...p.supportedPaymentMethods, method] };
      })
    );
  }

  // ---------- live custom-mode computation: instant, no network call ----------
  const live = useMemo(() => resolveCustomState(transaction, psps, amountConfig, conversionRates), [transaction, psps, amountConfig, conversionRates]);
  const customNone = mode === "custom" && live.eligible.length === 0;
  const customSingle = mode === "custom" && live.eligible.length === 1;
  const customStale = jevSnapshot !== null && (JSON.stringify(jevSnapshot.transaction) !== JSON.stringify(transaction) || JSON.stringify(jevSnapshot.psps) !== JSON.stringify(psps));
  const customUnasked = jevSnapshot === null;

  const preset = presets[scenarioId][exampleType];

  // ---------- build the shared render model, from whichever source is active ----------
  const model = useMemo(() => {
    if (mode === "preset") {
      const tx = preset.transaction as unknown as RouterInput["tx"];
      const observed: Partial<Record<PspId, ObservedPspStats>> = {};
      for (const id of preset.eligiblePspIds) observed[id as PspId] = preset.observed[id];
      const eligible = (preset.request.state?.psps ?? []).map((p) => minimalPspConfig(p.id as PspId, p.fixed_fee_eur));
      const routerInput: RouterInput = { tx, eligible, observed };

      const r2Params = r2ParamsByScenario[scenarioId];
      const r1 = mkRuleBook("R1 · hand-tuned", "Same numbers in every scenario.", r1Params, routerInput);
      const r2 = mkRuleBook("R2 · grid-search tuned", `Tuned for "${SCENARIO_LABELS[scenarioId]}": large-payment line at €${r2Params.largeThreshold}.`, r2Params, routerInput);

      const jevId = preset.jevChoice as PspId;
      const conf = preset.jevConfidence ?? Math.max(...Object.values(preset.jevProbabilities));
      return buildModel({
        eligiblePspIds: preset.eligiblePspIds as PspId[],
        r1Choice: r1.choice,
        r2Choice: r2.choice,
        r1Book: r1.book,
        r2Book: r2.book,
        jevState: { kind: "ok", choice: jevId, probabilities: preset.jevProbabilities, confidence: conf, stale: false, tag: "Replayed from test", tagBg: INDIGO_PALE, tagFg: INDIGO_DARK },
        amountText: `${Math.round(Number((preset.transaction as Record<string, unknown>).amount))} ${(preset.transaction as Record<string, unknown>).currency}`,
        inputRows: buildInputRows(preset.eligiblePspIds as PspId[], observed, tx),
        outcomes: buildOutcomesFromPreset(preset),
      });
    }

    if (customNone) return null;
    if (customSingle) return null;

    const routerInput: RouterInput = { tx: live.tx, eligible: live.eligible, observed: live.observed };
    const r2Params = r2ParamsByScenario.stable;
    const r1 = mkRuleBook("R1 · hand-tuned", "Same numbers in every scenario.", r1Params, routerInput);
    const r2 = mkRuleBook("R2 · grid-search tuned", "One generic set, tuned on Stable. Custom mode doesn't retune per transaction.", r2Params, routerInput);

    const eligibleIds = live.eligible.map((p) => p.id);
    const jevState: JevState = customUnasked
      ? { kind: "unasked" }
      : jevResult === null
        ? { kind: "unasked" }
        : jevResult.status !== "ok"
          ? { kind: "failed" }
          : jevResult.jev.status !== "ok"
            ? { kind: "invalid", reason: jevResult.jev.status === "invalid" ? "Invalid choice" : "Unreachable" }
            : {
                kind: "ok",
                choice: jevResult.jev.choice,
                probabilities: jevResult.jev.probabilities,
                confidence: jevResult.jev.confidence ?? Math.max(...Object.values(jevResult.jev.probabilities)),
                stale: customStale,
                tag: customStale ? "Out of date" : "Live model",
                tagBg: customStale ? "#e8c88a" : TEAL,
                tagFg: customStale ? INDIGO_DARK : INDIGO_DARK,
              };

    return buildModel({
      eligiblePspIds: eligibleIds,
      r1Choice: r1.choice,
      r2Choice: r2.choice,
      r1Book: r1.book,
      r2Book: r2.book,
      jevState,
      amountText: `${live.tx.amount.toLocaleString()} ${live.tx.currency}`,
      inputRows: buildInputRows(eligibleIds, live.observed, live.tx),
      outcomes: buildOutcomesFromLive(r1.choice, r2.choice, jevState, live),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, preset, scenarioId, live, customNone, customSingle, customStale, customUnasked, jevResult, rolls, r1Params, r2ParamsByScenario]);

  const modeLabel =
    mode === "custom"
      ? "Jev answers live from a hosted model. Each ask costs real money and is rate-limited, so the button does the asking."
      : "Replaying recorded decisions from the original experiment. Instant and free, so click around.";

  return (
    <div style={{ background: BG, color: TEXT, margin: "-32px -16px", padding: "32px 16px", fontFamily: "'Instrument Sans', Helvetica, Arial, sans-serif", fontSize: 15, lineHeight: 1.5 }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <Hero />

        <Step
          n={1}
          title="Choose the payment"
          action={
            <div style={{ display: "flex", gap: 4, padding: 4, border: "1px solid rgba(255,255,255,.12)", borderRadius: 999 }}>
              <PillButton active={mode === "preset"} onClick={() => setMode("preset")}>
                Replay · free
              </PillButton>
              <PillButton active={mode === "custom"} onClick={() => setMode("custom")}>
                Your numbers · live AI
              </PillButton>
            </div>
          }
        >
          <div style={{ fontSize: 14, color: MUTED1, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ marginTop: 7, width: 8, height: 8, borderRadius: "50%", flex: "none", background: mode === "preset" ? INDIGO_PALE : TEAL }} />
            <span>{modeLabel}</span>
          </div>

          {mode === "preset" ? (
            <PresetPicker scenarioId={scenarioId} setScenarioId={setScenarioId} exampleType={exampleType} setExampleType={setExampleType} />
          ) : (
            <CustomForm
              transaction={transaction}
              setTransaction={setTransaction}
              psps={psps}
              setPsps={setPsps}
              toggleSupportedCurrency={toggleSupportedCurrency}
              toggleSupportedMethod={toggleSupportedMethod}
              moreOpen={moreOpen}
              setMoreOpen={setMoreOpen}
              onReset={() => {
                setTransaction(DEFAULT_TRANSACTION);
                setPsps(DEFAULT_PSPS);
                setJevResult(null);
                setJevSnapshot(null);
              }}
              eligibility={live.eligibility}
            />
          )}
        </Step>

        {error && (
          <div style={{ marginTop: -24, marginBottom: 24, borderRadius: 12, padding: 14, border: `1px solid ${RED}`, background: "oklch(0.72 0.15 25 / .08)", color: TEXT, fontSize: 14 }}>
            {error}
          </div>
        )}

        {customNone && (
          <div style={{ borderRadius: 18, padding: "26px 28px", border: `1px solid oklch(0.72 0.15 25 / .5)`, background: "oklch(0.72 0.15 25 / .07)", marginBottom: 56 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: ".06em", color: RED }}>NO ELIGIBLE PSP</div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>Nobody can take this payment.</div>
            <div style={{ color: MUTED1, marginTop: 6 }}>Every PSP is off or doesn&apos;t support this payment method. Turn one back on.</div>
          </div>
        )}

        {customSingle && (
          <SingleEligibleView eligible={live.eligible[0]!} amountEUR={live.tx.amountEUR} />
        )}

        {model && (
          <>
            <Step n={2} title="Three routers read the same data">
              <div style={{ border: "1px solid rgba(255,255,255,.14)", borderRadius: 16, padding: "18px 20px", background: CARD_BG, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600 }}>A {model.amountText} payment</span>
                  <span style={{ fontSize: 13, color: MUTED2 }}>Identical input, sent to all three</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
                  {model.inputRows.map((ir, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, borderRadius: 8, padding: "8px 12px", background: "rgba(255,255,255,.04)" }}>
                      <span style={{ color: MUTED1 }}>{ir.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{ir.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12 }}>
                {model.routers.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      borderRadius: 16,
                      padding: 20,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      border: `1px solid ${r.isJev ? "rgba(154,160,255,.45)" : "rgba(255,255,255,.12)"}`,
                      background: r.isJev ? "rgba(154,160,255,.07)" : CARD_BG,
                      opacity: r.dim ? 0.55 : 1,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: r.color }}>
                        {r.id} · {r.kindLabel}
                      </span>
                      <span style={{ fontSize: 11.5, borderRadius: 999, padding: "2px 9px", color: r.tagFg, background: r.tagBg }}>{r.tagLabel}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: MUTED2, minHeight: 40 }}>{r.how}</div>
                    <div style={{ fontSize: 12, color: MUTED2, letterSpacing: ".05em" }}>CHOOSES</div>
                    <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1 }}>{r.pickLabel}</div>
                    <div style={{ fontSize: 13.5, color: MUTED1 }}>{r.why}</div>
                    {r.isJev && mode === "custom" && (
                      <button
                        onClick={askJev}
                        disabled={loading}
                        style={{ marginTop: 6, cursor: "pointer", font: "inherit", fontWeight: 600, fontSize: 14, border: 0, borderRadius: 10, padding: "10px 14px", color: INDIGO_DARK, background: loading ? "#6b6e99" : INDIGO }}
                      >
                        {loading ? "Asking Jev…" : customUnasked ? "Ask Jev" : "Ask Jev again"}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <VerdictBanner v={model.verdict} />

              <div>
                <div style={{ fontWeight: 600 }}>
                  Open the rule books <span style={{ fontWeight: 400, color: MUTED2, fontSize: 14 }}>· the first matching rule wins; the highlighted one decided this payment</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginTop: 12 }}>
                  {[model.r1Book, model.r2Book].map((rb) => (
                    <details key={rb.title} style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, padding: "16px 18px", background: CARD_BG }}>
                      <summary style={{ cursor: "pointer", display: "flex", flexDirection: "column", gap: 2, listStyle: "none" }}>
                        <span style={{ fontWeight: 600 }}>{rb.title}</span>
                        <span style={{ fontSize: 13, color: MUTED2 }}>{rb.note}</span>
                      </summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
                        {rb.rows.map((row) => (
                          <div
                            key={row.n}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "22px 1fr auto",
                              gap: 10,
                              alignItems: "baseline",
                              border: `1px solid ${row.fired ? "oklch(0.76 0.15 350 / .6)" : "rgba(255,255,255,.08)"}`,
                              background: row.fired ? "oklch(0.76 0.15 350 / .1)" : "transparent",
                              borderRadius: 10,
                              padding: "9px 12px",
                              opacity: row.dim ? 0.55 : 1,
                            }}
                          >
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: MUTED2 }}>{row.n}</span>
                            <span style={{ fontSize: 14, fontWeight: row.fired ? 600 : 400 }}>{row.text}</span>
                            <span style={{ fontSize: 11, letterSpacing: ".05em", color: row.fired ? PINK : MUTED2 }}>{row.state}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </Step>

            <Step n={3} title="Why Jev chose that">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
                <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 22, background: CARD_BG, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ fontWeight: 600 }}>How likely Jev thought each PSP was best</div>
                  {model.probs.map((p) => (
                    <div key={p.name} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                        <span style={{ fontWeight: p.top ? 600 : 400 }}>{p.name}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{p.text}</span>
                      </div>
                      <div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,.07)", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 5, width: p.width, background: p.top ? INDIGO : "rgba(255,255,255,.3)" }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 13.5, color: MUTED2 }}>{model.confText == null ? "Jev hasn't answered yet." : `Jev is ${model.confText} sure of its top pick.`}</div>
                </div>
                <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 22, background: CARD_BG, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontWeight: 600 }}>Sounding sure isn&apos;t being right</div>
                  <div style={{ color: MUTED1 }}>
                    In the full test, Jev&apos;s confidence barely tracked how often it actually picked the better PSP. A 90% answer was not much more trustworthy than a 60%
                    one.
                  </div>
                  <a href="/results" style={{ fontSize: 14 }}>
                    See the calibration chart on Results →
                  </a>
                </div>
              </div>
            </Step>

            <Step n={4} title="What would have happened" action={mode === "custom" && <TextButton onClick={() => setRolls([Math.random(), Math.random(), Math.random()])}>Roll the dice again</TextButton>}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, color: MUTED1, maxWidth: 720 }}>
                <span style={{ flex: "none", fontSize: 11.5, borderRadius: 4, padding: "2px 8px", border: "1px dashed " + MUTED2, color: TEXT, marginTop: 2 }}>SIMULATED</span>
                <span>Not from Jev or the real world. Each outcome is a random draw against the PSP&apos;s approval rate{mode === "custom" ? ", so re-rolling can change it" : ""}. Only the routers&apos; picks above are real decisions.</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
                {model.outcomes.map((o, i) => (
                  <div
                    key={i}
                    style={{
                      borderRadius: 16,
                      padding: 20,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      border: `1px dashed ${o.color}`,
                      background: "repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 8px,transparent 8px 16px)",
                    }}
                  >
                    <div style={{ fontSize: 13, color: MUTED2 }}>{o.who} sent it to</div>
                    <div style={{ fontSize: 20, fontWeight: 600 }}>{o.psp}</div>
                    <div style={{ fontSize: 26, fontWeight: 600, color: o.color, letterSpacing: "-.02em" }}>{o.status}</div>
                    <div style={{ fontSize: 14, color: MUTED1 }}>{o.cost}</div>
                  </div>
                ))}
              </div>
            </Step>

            <RawEvidence
              open={rawOpen}
              setOpen={setRawOpen}
              tab={rawTab}
              setTab={setRawTab}
              copied={copied}
              setCopied={setCopied}
              mode={mode}
              preset={mode === "preset" ? preset : null}
              jevResult={jevResult}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- building blocks ----------

function Hero() {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 760, marginBottom: 56 }}>
      <h1 style={{ margin: 0, fontSize: "clamp(34px,5vw,54px)", lineHeight: 1.04, letterSpacing: "-.03em", fontWeight: 600 }}>
        Same payment. Same data. <span style={{ color: "#f08ab8" }}>Different answers.</span>
      </h1>
      <p style={{ margin: 0, fontSize: 18, color: MUTED1 }}>
        Every card payment gets sent to one of several payment companies (<em style={{ fontStyle: "normal", color: TEXT }}>PSPs</em>). Today, hand-written rules choose which. We
        tested whether an AI model, <strong style={{ fontWeight: 600 }}>Jev</strong>, could choose better. Here you can watch both decide, then change a number and see who flips.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        {[
          ["01", "Pick a payment", "Or enter your own numbers."],
          ["02", "Watch three routers choose", "Two rule books, one AI."],
          ["03", "Nudge a slider", "See if the decision flips."],
        ].map(([n, t, d]) => (
          <div key={n} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: INDIGO }}>{n}</div>
            <div style={{ fontWeight: 600 }}>{t}</div>
            <div style={{ color: MUTED2, fontSize: 14 }}>{d}</div>
          </div>
        ))}
      </div>
      <details style={{ color: MUTED1, fontSize: 14.5 }}>
        <summary style={{ cursor: "pointer", color: INDIGO_LT }}>New to payments? Three terms</summary>
        <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 18px" }}>
          <dt style={{ fontWeight: 600, color: TEXT }}>PSP</dt>
          <dd style={{ margin: 0 }}>Payment service provider. The company that actually moves the money, e.g. a bank or processor. Each charges a fee and approves a different share of attempts.</dd>
          <dt style={{ fontWeight: 600, color: TEXT }}>Router</dt>
          <dd style={{ margin: 0 }}>The decision-maker that picks which PSP gets each payment.</dd>
          <dt style={{ fontWeight: 600, color: TEXT }}>Acceptance rate</dt>
          <dd style={{ margin: 0 }}>Out of 100 attempts, how many the PSP approves. A cheap PSP that declines a lot loses sales.</dd>
        </dl>
      </details>
    </section>
  );
}

function Step({ n, title, action, children }: { n: number; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 56 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: INDIGO, letterSpacing: ".06em" }}>STEP {n}</div>
          <h2 style={{ margin: 0, fontSize: 26, letterSpacing: "-.02em", fontWeight: 600 }}>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ cursor: "pointer", font: "inherit", fontSize: 14, border: 0, borderRadius: 999, padding: "8px 16px", color: active ? INDIGO_DARK : MUTED1, background: active ? INDIGO : "transparent" }}
    >
      {children}
    </button>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ cursor: "pointer", font: "inherit", fontSize: 14, color: TEXT, background: "transparent", border: "1px solid rgba(255,255,255,.25)", borderRadius: 10, padding: "8px 14px" }}>
      {children}
    </button>
  );
}

function PresetPicker({
  scenarioId,
  setScenarioId,
  exampleType,
  setExampleType,
}: {
  scenarioId: ScenarioId;
  setScenarioId: (id: ScenarioId) => void;
  exampleType: "disagreement" | "agreement";
  setExampleType: (t: "disagreement" | "agreement") => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
        {SCENARIO_IDS.map((id) => {
          const active = scenarioId === id;
          return (
            <button
              key={id}
              onClick={() => setScenarioId(id)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                font: "inherit",
                color: TEXT,
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                border: `1px solid ${active ? INDIGO : "rgba(255,255,255,.1)"}`,
                background: active ? "rgba(154,160,255,.1)" : "transparent",
              }}
            >
              <span style={{ fontWeight: 600 }}>{SCENARIO_LABELS[id]}</span>
              <span style={{ fontSize: 13.5, color: MUTED2 }}>{SCENARIO_DESCRIPTIONS[id]}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, color: MUTED2 }}>
        Worked example
        {(["disagreement", "agreement"] as const).map((t, i) => {
          const active = exampleType === t;
          return (
            <button
              key={t}
              onClick={() => setExampleType(t)}
              style={{
                cursor: "pointer",
                font: "inherit",
                fontSize: 14,
                borderRadius: 8,
                padding: "5px 14px",
                color: TEXT,
                border: `1px solid ${active ? INDIGO : "rgba(255,255,255,.15)"}`,
                background: active ? "rgba(154,160,255,.12)" : "transparent",
              }}
            >
              Example {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function fieldLabel(text: string, tag?: string, tagActive?: boolean) {
  return (
    <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 13.5 }}>
      <span style={{ fontWeight: 600 }}>{text}</span>
      {tag && <span style={{ fontSize: 11, borderRadius: 999, padding: "1px 8px", color: tagActive ? INDIGO_DARK : MUTED1, background: tagActive ? INDIGO_PALE : "rgba(255,255,255,.08)" }}>{tag}</span>}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  font: "inherit",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 14,
  color: TEXT,
  background: "#121211",
  border: "1px solid rgba(255,255,255,.18)",
  borderRadius: 8,
  padding: "8px 10px",
  width: "100%",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = { ...inputStyle, fontFamily: "inherit" };

function CustomForm({
  transaction,
  setTransaction,
  psps,
  setPsps,
  toggleSupportedCurrency,
  toggleSupportedMethod,
  moreOpen,
  setMoreOpen,
  onReset,
  eligibility,
}: {
  transaction: TransactionInput;
  setTransaction: (t: TransactionInput) => void;
  psps: PspInput[];
  setPsps: (p: PspInput[]) => void;
  toggleSupportedCurrency: (id: string, c: Currency) => void;
  toggleSupportedMethod: (id: string, m: PaymentMethod) => void;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
  onReset: () => void;
  eligibility: Array<{ pspId: string; eligible: boolean; reasons: string[] }>;
}) {
  function updatePsp(id: string, field: keyof PspInput, value: number) {
    setPsps(psps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }
  const eu = transaction.currency === "EUR" && transaction.paymentMethod === "card" && (["DE", "NL", "FR"] as const).includes(transaction.country as "DE" | "NL" | "FR");
  const amountHint = transaction.amount < 25 ? "Under 25: rules pick the lowest fixed fee." : transaction.amount >= 500 ? "500 or more: large-payment rules." : "25 to 499: small-payment rules.";

  return (
    <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 24, background: CARD_BG }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 600 }}>The transaction</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {fieldLabel("Amount", "Picks the rule", true)}
            <input type="number" min={0.01} step={0.01} value={transaction.amount} onChange={(e) => setTransaction({ ...transaction, amount: Number(e.target.value) })} style={inputStyle} />
            <span style={{ fontSize: 12, color: MUTED3 }}>{amountHint}</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {fieldLabel("Currency", "Filters PSPs", true)}
            <select value={transaction.currency} onChange={(e) => setTransaction({ ...transaction, currency: e.target.value as TransactionInput["currency"] })} style={selectStyle}>
              {(["EUR", "GBP", "USD"] as const).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: MUTED3 }}>USD also triggers a named rule.</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {fieldLabel("Payment method", "Filters PSPs", true)}
            <select value={transaction.paymentMethod} onChange={(e) => setTransaction({ ...transaction, paymentMethod: e.target.value as TransactionInput["paymentMethod"] })} style={selectStyle}>
              {(["card", "paypal", "sepa_debit"] as const).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: MUTED3 }}>PSP C doesn&apos;t support PayPal.</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {fieldLabel("Country", eu ? "Active now" : "Conditional", eu)}
            <select value={transaction.country} onChange={(e) => setTransaction({ ...transaction, country: e.target.value as TransactionInput["country"] })} style={selectStyle}>
              {(["DE", "NL", "FR", "UK", "US"] as const).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: MUTED3 }}>{eu ? "Triggers the EU-card rule." : "Only matters for EUR + card + DE, NL or FR."}</span>
          </label>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontWeight: 600 }}>The three PSPs</div>
        <div style={{ fontSize: 13.5, color: MUTED2, maxWidth: 700 }}>A PSP that doesn&apos;t support this payment&apos;s currency or method is removed before R1, R2 or Jev ever see it. Each PSP must keep at least one of each.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14 }}>
          {psps.map((psp) => {
            const elig = eligibility.find((e) => e.pspId === psp.id);
            const ok = elig?.eligible ?? true;
            return (
              <div key={psp.id} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 14, opacity: ok ? 1 : 0.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <label style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                    <input type="checkbox" checked={psp.enabled} onChange={(e) => setPsps(psps.map((p) => (p.id === psp.id ? { ...p, enabled: e.target.checked } : p)))} style={{ accentColor: INDIGO, width: 16, height: 16 }} />
                    {DISPLAY_NAME[psp.id]}
                  </label>
                  <span style={{ fontSize: 12, color: ok ? GREEN : RED }}>{ok ? "Eligible" : (elig?.reasons ?? []).join(", ") || "Not eligible"}</span>
                </div>

                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: MUTED1 }}>
                    <span>Acceptance rate</span>
                    <span style={{ fontSize: 11, color: MUTED2 }}>Main signal</span>
                  </span>
                  <input type="number" step={0.001} value={psp.acceptanceRate} onChange={(e) => updatePsp(psp.id, "acceptanceRate", Number(e.target.value))} style={inputStyle} />
                  <span style={{ fontSize: 12, color: MUTED3 }}>0 to 1. Share of attempts approved.</span>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: MUTED1 }}>
                    <span>Cost %</span>
                    <span style={{ fontSize: 11, color: MUTED2 }}>Fee</span>
                  </span>
                  <input type="number" step={0.1} value={psp.transactionCostPercent} onChange={(e) => updatePsp(psp.id, "transactionCostPercent", Number(e.target.value))} style={inputStyle} />
                  <span style={{ fontSize: 12, color: MUTED3 }}>Variable fee, % of amount.</span>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: MUTED1 }}>
                    <span>Fixed fee</span>
                    <span style={{ fontSize: 11, color: MUTED2 }}>Fee</span>
                  </span>
                  <input type="number" step={0.01} value={psp.fixedFee} onChange={(e) => updatePsp(psp.id, "fixedFee", Number(e.target.value))} style={inputStyle} />
                  <span style={{ fontSize: 12, color: MUTED3 }}>Added per payment.</span>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: MUTED1 }}>
                    <span>Availability</span>
                    <span style={{ fontSize: 11, color: MUTED2 }}>Safety check</span>
                  </span>
                  <input type="number" step={0.001} value={psp.availabilityRate} onChange={(e) => updatePsp(psp.id, "availabilityRate", Number(e.target.value))} style={inputStyle} />
                  <span style={{ fontSize: 12, color: MUTED3 }}>Preferred PSP is skipped if below 0.99.</span>
                </label>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 12 }}>
                  <span style={{ fontSize: 13.5, color: MUTED1 }}>Takes currencies</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["EUR", "GBP", "USD"] as const).map((c) => {
                      const on = psp.supportedCurrencies.includes(c);
                      const only = on && psp.supportedCurrencies.length === 1;
                      return (
                        <Chip key={c} on={on} only={only} onClick={() => toggleSupportedCurrency(psp.id, c)}>
                          {c}
                        </Chip>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: 13.5, color: MUTED1, marginTop: 4 }}>Takes methods</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["card", "paypal", "sepa_debit"] as const).map((m) => {
                      const on = psp.supportedPaymentMethods.includes(m);
                      const only = on && psp.supportedPaymentMethods.length === 1;
                      return (
                        <Chip key={m} on={on} only={only} onClick={() => toggleSupportedMethod(psp.id, m)}>
                          {m}
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setMoreOpen(!moreOpen)} style={{ cursor: "pointer", font: "inherit", fontSize: 14, color: INDIGO_LT, background: "transparent", border: 0, padding: 0 }}>
          {(moreOpen ? "− Hide" : "+ Show") + " details that don't change the pick"}
        </button>
        <TextButton onClick={onReset}>Reset to defaults</TextButton>
      </div>

      {moreOpen && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 18, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 13.5, color: MUTED1, maxWidth: 700 }}>
            <strong style={{ fontWeight: 600, color: TEXT }}>These don&apos;t change any pick in live mode.</strong> The rules never read them, and the numbers sent to Jev stay the same whatever you choose. They&apos;re
            here for realism and show up in the raw request.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
            {transaction.paymentMethod === "card" && (
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {fieldLabel("Card scheme", "No effect")}
                <select value={transaction.cardScheme ?? "visa"} onChange={(e) => setTransaction({ ...transaction, cardScheme: e.target.value as TransactionInput["cardScheme"] })} style={selectStyle}>
                  {(["visa", "mastercard", "amex"] as const).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 12, color: MUTED3 }}>Sent to Jev as context only.</span>
              </label>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {fieldLabel("Device", "No effect")}
              <select value={transaction.device} onChange={(e) => setTransaction({ ...transaction, device: e.target.value as TransactionInput["device"] })} style={selectStyle}>
                {(["desktop", "mobile"] as const).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {fieldLabel("Customer type", "No effect")}
              <select value={transaction.customerType} onChange={(e) => setTransaction({ ...transaction, customerType: e.target.value as TransactionInput["customerType"] })} style={selectStyle}>
                {(["new", "returning"] as const).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 12, color: MUTED3 }}>Text only. Numbers sent to Jev stay identical.</span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={transaction.threeDsEligible} onChange={(e) => setTransaction({ ...transaction, threeDsEligible: e.target.checked })} style={{ accentColor: INDIGO, width: 16, height: 16 }} />
              3DS eligible
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14 }}>
            {psps.map((psp) => (
              <div key={psp.id} style={{ border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{DISPLAY_NAME[psp.id]}</div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13.5, color: MUTED1 }}>Chargeback rate</span>
                  <input type="number" step={0.0001} value={psp.chargebackRate} onChange={(e) => updatePsp(psp.id, "chargebackRate", Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13.5, color: MUTED1 }}>Latency (ms)</span>
                  <input type="number" step={1} value={psp.latencyMs} onChange={(e) => updatePsp(psp.id, "latencyMs", Number(e.target.value))} style={inputStyle} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 13.5, color: MUTED1 }}>Sample size</span>
                  <input type="number" step={1} value={psp.sampleSize} onChange={(e) => updatePsp(psp.id, "sampleSize", Number(e.target.value))} style={inputStyle} />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 13.5, color: MUTED2 }}>The rule routers react instantly. Jev is a live model call, so you ask it when you&apos;re ready.</div>
    </div>
  );
}

function Chip({ on, only, onClick, children }: { on: boolean; only: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={only}
      title={only ? "Each PSP needs at least one" : ""}
      style={{
        font: "inherit",
        fontSize: 12.5,
        borderRadius: 999,
        padding: "3px 11px",
        color: on ? INDIGO_DARK : MUTED1,
        background: on ? INDIGO_PALE : "transparent",
        border: `1px solid ${on ? INDIGO_PALE : "rgba(255,255,255,.2)"}`,
        opacity: only ? 0.6 : 1,
        cursor: only ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SingleEligibleView({ eligible, amountEUR }: { eligible: PspConfig; amountEUR: number }) {
  const outcome = useMemo(() => simulateOnceFromInput(eligible, amountEUR), [eligible, amountEUR]);
  return (
    <div style={{ marginBottom: 56 }}>
      <p style={{ color: MUTED1, marginBottom: 12 }}>Only one PSP is eligible — routed deterministically, Jev skipped.</p>
      <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: 16, display: "inline-block" }}>
        <div style={{ fontSize: 12, color: MUTED2, textTransform: "uppercase" }}>Route</div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{DISPLAY_NAME[eligible.id]}</div>
      </div>
      <div style={{ marginTop: 12, fontSize: 14 }}>
        <span style={{ color: outcome.authorized ? GREEN : RED }}>{outcome.authorized ? "Authorized" : "Declined"}</span>
        <span style={{ color: MUTED1 }}> · €{outcome.netCostEUR.toFixed(4)} net cost</span>
      </div>
    </div>
  );
}

function VerdictBanner({ v }: { v: VerdictModel }) {
  return (
    <div style={{ borderRadius: 18, padding: "26px 28px", display: "flex", flexDirection: "column", gap: 10, border: `1px solid ${v.border}`, background: v.bg }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, letterSpacing: ".06em", color: v.color }}>{v.eyebrow}</div>
      <div style={{ fontSize: "clamp(22px,3.4vw,34px)", fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1.15 }}>{v.title}</div>
      <div style={{ color: MUTED1, maxWidth: 680 }}>{v.body}</div>
    </div>
  );
}

function RawEvidence({
  open,
  setOpen,
  tab,
  setTab,
  copied,
  setCopied,
  mode,
  preset,
  jevResult,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  tab: number;
  setTab: (n: number) => void;
  copied: boolean;
  setCopied: (v: boolean) => void;
  mode: "preset" | "custom";
  preset: PresetExample | null;
  jevResult: JevOnlyResult | null;
}) {
  const available = mode === "preset" ? preset !== null : jevResult !== null && jevResult.status === "ok" && jevResult.jev.status === "ok";
  if (!available) {
    return (
      <section style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 28, fontSize: 14, color: MUTED2 }}>
        Under the hood: ask Jev at least once to see the raw request, response and schema.
      </section>
    );
  }

  const tabs = ["Request", "Response", "Schema"];
  let note = "";
  let data: unknown = null;
  if (mode === "preset" && preset) {
    const payload = [
      { n: "The exact data sent to the model.", o: preset.request },
      { n: "Recorded during the original experiment and replayed here.", o: preset.rawResponse },
      { n: "The shape Jev must answer in.", o: preset.schema },
    ][tab]!;
    note = payload.n;
    data = payload.o;
  } else if (jevResult && jevResult.status === "ok" && jevResult.jev.status === "ok") {
    const jev = jevResult.jev;
    const payload = [
      { n: "The exact data sent to the model.", o: jev.request },
      { n: "Returned by the live model for your last request.", o: jev.rawResponse },
      { n: "The shape Jev must answer in.", o: jev.schema },
    ][tab]!;
    note = payload.n;
    data = payload.o;
  }
  const rawText = JSON.stringify(data, null, 2);

  return (
    <section style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 28, display: "flex", flexDirection: "column", gap: 14 }}>
      <button onClick={() => setOpen(!open)} style={{ alignSelf: "flex-start", cursor: "pointer", font: "inherit", fontSize: 15, fontWeight: 600, color: TEXT, background: "transparent", border: 0, padding: 0, display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: INDIGO }}>{open ? "−" : "+"}</span>
        Under the hood: the raw evidence
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tabs.map((label, i) => (
              <button
                key={label}
                onClick={() => setTab(i)}
                style={{ cursor: "pointer", font: "inherit", fontSize: 13.5, borderRadius: 8, padding: "6px 12px", color: TEXT, border: "1px solid rgba(255,255,255,.15)", background: tab === i ? "#2f3150" : "transparent" }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 13.5, color: MUTED2 }}>{note}</div>
          <div style={{ position: "relative" }}>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(rawText);
                } catch {
                  // ignore
                }
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              style={{ position: "absolute", top: 10, right: 10, cursor: "pointer", font: "inherit", fontSize: 12.5, color: TEXT, background: "#2a2a28", border: "1px solid rgba(255,255,255,.15)", borderRadius: 6, padding: "4px 10px" }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <pre style={{ margin: 0, background: "#0f0f0e", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 18, overflow: "auto", maxHeight: 340, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, lineHeight: 1.6, color: "#cfd0c8" }}>
              {rawText}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- render-model assembly shared by preset and custom modes ----------

type JevState =
  | { kind: "unasked" }
  | { kind: "failed" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; choice: PspId; probabilities: Record<string, number>; confidence: number; stale: boolean; tag: string; tagBg: string; tagFg: string };

interface Model {
  amountText: string;
  inputRows: { name: string; val: string }[];
  routers: RouterCardModel[];
  verdict: VerdictModel;
  r1Book: RuleBookModel;
  r2Book: RuleBookModel;
  probs: { name: string; text: string; width: string; top: boolean }[];
  confText: string | null;
  outcomes: OutcomeModel[];
}

function buildInputRows(eligiblePspIds: PspId[], observed: Partial<Record<PspId, ObservedPspStats>>, tx: RouterInput["tx"]): { name: string; val: string }[] {
  const rows: { name: string; val: string }[] = [
    { name: "Currency", val: tx.currency },
    { name: "Method", val: tx.paymentMethod },
    { name: "Country", val: tx.country },
  ];
  for (const id of PSP_IDS) {
    if (!eligiblePspIds.includes(id)) continue;
    const stats = observed[id];
    if (stats?.acceptanceOverall.value != null) {
      rows.push({ name: `${DISPLAY_NAME[id]} approves`, val: pct(stats.acceptanceOverall.value) });
    }
  }
  return rows;
}

function buildOutcomesFromPreset(preset: PresetExample): OutcomeModel[] {
  const picks: Record<string, string[]> = {};
  const add = (label: string, id: string) => {
    (picks[id] ??= []).push(label);
  };
  add("R1", preset.r1Choice);
  add("R2", preset.r2Choice);
  add("Jev", preset.jevChoice);
  return Object.entries(picks).map(([id, who]) => {
    const o = preset.outcomesByPsp[id];
    const ok = o?.authorized ?? false;
    return {
      who: who.join(" + "),
      psp: DISPLAY_NAME[id as PspId] ?? id,
      status: ok ? "Approved" : "Declined",
      color: ok ? GREEN : RED,
      cost: ok ? `Sale kept. Net cost €${(o?.netCostEUR ?? 0).toFixed(4)}.` : "Sale lost.",
    };
  });
}

function buildOutcomesFromLive(
  r1Choice: PspId,
  r2Choice: PspId,
  jevState: JevState,
  live: { eligible: PspConfig[]; tx: { amountEUR: number } }
): OutcomeModel[] {
  const picks: Record<string, string[]> = {};
  const add = (label: string, id: PspId) => {
    (picks[id] ??= []).push(label);
  };
  add("R1", r1Choice);
  add("R2", r2Choice);
  if (jevState.kind === "ok") add("Jev", jevState.choice);

  return Object.entries(picks).map(([id, who]) => {
    const psp = live.eligible.find((p) => p.id === id)!;
    const outcome = simulateOnceFromInput(psp, live.tx.amountEUR);
    return {
      who: who.join(" + "),
      psp: DISPLAY_NAME[id as PspId] ?? id,
      status: outcome.authorized ? "Approved" : "Declined",
      color: outcome.authorized ? GREEN : RED,
      cost: outcome.authorized ? `Sale kept. Net cost €${outcome.netCostEUR.toFixed(4)}.` : "Sale lost.",
    };
  });
}

function buildModel(args: {
  eligiblePspIds: PspId[];
  r1Choice: PspId;
  r2Choice: PspId;
  r1Book: RuleBookModel;
  r2Book: RuleBookModel;
  jevState: JevState;
  amountText: string;
  inputRows: { name: string; val: string }[];
  outcomes: OutcomeModel[];
}): Model {
  const { r1Choice, r2Choice, jevState } = args;

  const jevPick = jevState.kind === "ok" ? DISPLAY_NAME[jevState.choice] : jevState.kind === "unasked" ? "Not asked yet" : jevState.kind === "failed" ? "Unreachable" : "Invalid choice";
  const jevWhy =
    jevState.kind === "ok"
      ? jevState.stale
        ? "Based on your earlier numbers. Ask again."
        : `Confidence ${pct(jevState.confidence)}`
      : jevState.kind === "unasked"
        ? "Press the button to call the live model."
        : "No routing decision was made.";

  const routers: RouterCardModel[] = [
    {
      id: "R1",
      kindLabel: "Rules",
      how: "Hand-written rule book, first match wins.",
      pickLabel: DISPLAY_NAME[r1Choice],
      why: args.r1Book.rows.find((r) => r.fired && r.n <= 5)?.text ?? "",
      color: "#d9d6cc",
      tagLabel: "Local rule",
      tagFg: TEXT,
      tagBg: "rgba(255,255,255,.1)",
      isJev: false,
      dim: false,
    },
    {
      id: "R2",
      kindLabel: "Rules",
      how: "A second rule book with different priorities.",
      pickLabel: DISPLAY_NAME[r2Choice],
      why: args.r2Book.rows.find((r) => r.fired && r.n <= 5)?.text ?? "",
      color: "#d9d6cc",
      tagLabel: "Local rule",
      tagFg: TEXT,
      tagBg: "rgba(255,255,255,.1)",
      isJev: false,
      dim: false,
    },
    {
      id: "Jev",
      kindLabel: "AI model",
      how: "Reads the same data and weighs trade-offs it learned from examples.",
      pickLabel: jevPick,
      why: jevWhy,
      color: INDIGO,
      tagLabel: jevState.kind === "ok" ? jevState.tag : jevState.kind === "unasked" ? "Not asked yet" : "Error",
      tagFg: jevState.kind === "ok" ? jevState.tagFg : INDIGO_DARK,
      tagBg: jevState.kind === "ok" ? jevState.tagBg : "rgba(255,255,255,.1)",
      isJev: true,
      dim: jevState.kind === "ok" && jevState.stale,
    },
  ];

  let verdict: VerdictModel;
  if (jevState.kind === "unasked") {
    verdict = {
      eyebrow: "WAITING ON JEV",
      title: "The rules have answered. Ask Jev to see if it agrees.",
      body: "R1 and R2 are formulas that run instantly. Jev is a real model call.",
      color: INDIGO,
      border: "rgba(154,160,255,.3)",
      bg: "rgba(154,160,255,.05)",
    };
  } else if (jevState.kind !== "ok") {
    verdict = {
      eyebrow: "JEV UNAVAILABLE",
      title: "Jev couldn't answer this time.",
      body: "R1 and R2 still routed this payment; try asking Jev again.",
      color: RED,
      border: "oklch(0.72 0.15 25 / .5)",
      bg: "oklch(0.72 0.15 25 / .07)",
    };
  } else {
    const jp = jevState.choice;
    if (jp === r1Choice && jp === r2Choice) {
      verdict = {
        eyebrow: "ALL THREE AGREE",
        title: `Everyone picked ${DISPLAY_NAME[jp]}.`,
        body: `Nothing to argue about here. Change the amount, currency or ${DISPLAY_NAME[jp]}'s approval rate and ask Jev again.`,
        color: GREEN,
        border: "rgba(255,255,255,.12)",
        bg: CARD_BG,
      };
    } else {
      const title = jp === r2Choice ? "Jev sides with R2 against R1" : jp === r1Choice ? "Jev sides with R1 against R2" : r1Choice === r2Choice ? "Both rule books agree. Jev doesn't" : "Jev disagrees with both rule books";
      const otherChoice = jp === r2Choice ? r1Choice : r2Choice;
      verdict = {
        eyebrow: "THEY DISAGREE",
        title: `${title}: ${DISPLAY_NAME[jp]} vs ${DISPLAY_NAME[otherChoice]}.`,
        body: `${jevState.stale ? "(Jev's answer is from your previous numbers.) " : ""}Nudge a number and watch who flips.`,
        color: PINK,
        border: "oklch(0.76 0.15 350 / .5)",
        bg: "oklch(0.76 0.15 350 / .08)",
      };
    }
  }

  const probEntries = jevState.kind === "ok" ? Object.entries(jevState.probabilities) : [];
  const topId = jevState.kind === "ok" ? jevState.choice : null;
  const probs = probEntries.map(([id, p]) => ({
    name: DISPLAY_NAME[id as PspId] ?? id,
    text: pct(p),
    width: `${Math.max(2, Math.round(p * 100))}%`,
    top: id === topId,
  }));

  return {
    amountText: args.amountText,
    inputRows: args.inputRows,
    routers,
    verdict,
    r1Book: args.r1Book,
    r2Book: args.r2Book,
    probs,
    confText: jevState.kind === "ok" ? pct(jevState.confidence) : null,
    outcomes: args.outcomes,
  };
}
