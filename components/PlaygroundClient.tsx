"use client";

import { useMemo, useState } from "react";
import type { PspInput, TransactionInput } from "../lib/playground/schema";
import type { CustomDecisionResult } from "../lib/playground/customDecision";
import { ROUTER_DESCRIPTIONS, SCENARIO_DESCRIPTIONS } from "../lib/content/glossary";

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

type PresetExample = {
  scenarioId: string;
  transactionIndex: number;
  transaction: Record<string, unknown>;
  eligiblePspIds: string[];
  observed: Record<string, { acceptanceOverall: { value: number | null; sampleSize: number }; acceptanceSegment: { value: number | null; sampleSize: number } }>;
  schema: unknown;
  request: unknown;
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

const STEPS = ["Transaction", "Rules (R1/R2)", "Jev", "Route", "Simulated outcome"];

function CopyableJson({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="relative">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 rounded bg-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-600"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 pt-10 text-xs text-emerald-300">{text}</pre>
    </div>
  );
}

type StepperStage = "idle" | "calling_jev" | "done";

/** A flow diagram of the decision pipeline with the current step highlighted — "calling_jev" is the one stage with real, perceptible latency (the live OpenRouter call); everything else is effectively instant. */
function Stepper({ activeStep, live }: { activeStep: StepperStage; live: boolean }) {
  const activeIndex = activeStep === "idle" ? 0 : activeStep === "calling_jev" ? 2 : STEPS.length - 1;
  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((step, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "current" : "upcoming";
          return (
            <div
              key={step}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                state === "current" ? "bg-indigo-500 text-white" : state === "done" ? "bg-indigo-500/20 text-indigo-300" : "bg-slate-800 text-slate-500"
              }`}
            >
              {state === "current" && activeStep === "calling_jev" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
              {i + 1}. {step}
            </div>
          );
        })}
      </div>
      {!live && activeStep === "done" && <p className="mt-1.5 text-xs text-slate-500">Replayed from a recorded decision — no live call made just now.</p>}
    </div>
  );
}

function ChoiceCard({ label, pspId, highlight, description }: { label: string; pspId: string; highlight?: boolean; description?: string }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-amber-500 bg-amber-500/10" : "border-slate-800 bg-slate-900/60"}`} title={description}>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-400">
        {label}
        {description && <span className="cursor-help text-slate-500">ⓘ</span>}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-100">{pspId}</div>
    </div>
  );
}

/** Always-visible, not hover-only — identity/meaning shouldn't depend on discovering a tooltip. */
function RouterLegend() {
  return (
    <dl className="mb-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
      <div>
        <dt className="font-medium text-slate-300">R1</dt>
        <dd>{ROUTER_DESCRIPTIONS.R1}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-300">R2</dt>
        <dd>{ROUTER_DESCRIPTIONS.R2}</dd>
      </div>
      <div>
        <dt className="font-medium text-slate-300">Jev</dt>
        <dd>{ROUTER_DESCRIPTIONS.Jev}</dd>
      </div>
    </dl>
  );
}

export default function PlaygroundClient({ presets }: { presets: PresetExamples }) {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [scenarioId, setScenarioId] = useState<ScenarioId>("stable");
  const [exampleType, setExampleType] = useState<"disagreement" | "agreement">("disagreement");

  const [transaction, setTransaction] = useState<TransactionInput>(DEFAULT_TRANSACTION);
  const [psps, setPsps] = useState<PspInput[]>(DEFAULT_PSPS);
  const [result, setResult] = useState<CustomDecisionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = presets[scenarioId][exampleType];

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    setResult(null);
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
        setResult(data);
      }
    } catch {
      setError("Jev could not be reached. No AI routing decision was made.");
    } finally {
      setLoading(false);
    }
  }

  const modeLabel = useMemo(
    () => (mode === "custom" ? "Simulating from your inputs" : `Simulating from preset world: ${SCENARIO_LABELS[scenarioId]}`),
    [mode, scenarioId]
  );

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-100">Playground</h1>
      <p className="mb-4 max-w-2xl text-slate-400">
        Set up a transaction and PSP stats yourself, or pick a preset scenario from the experiment. Watch R1, R2 and Jev route the same decision, side
        by side.
      </p>

      <div className="mb-4 inline-flex rounded-lg border border-slate-700 p-1">
        <button
          onClick={() => setMode("preset")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "preset" ? "bg-indigo-500 text-white" : "text-slate-300"}`}
        >
          Preset scenario
        </button>
        <button
          onClick={() => setMode("custom")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${mode === "custom" ? "bg-indigo-500 text-white" : "text-slate-300"}`}
        >
          Custom inputs
        </button>
      </div>

      <div className="mb-6 inline-block rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">{modeLabel}</div>

      {mode === "preset" ? (
        <div className="mb-8 flex flex-wrap gap-3">
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value as ScenarioId)} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
            {SCENARIO_IDS.map((id) => (
              <option key={id} value={id}>
                {SCENARIO_LABELS[id]}
              </option>
            ))}
          </select>
          <select value={exampleType} onChange={(e) => setExampleType(e.target.value as "disagreement" | "agreement")} className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">
            <option value="disagreement">Example where Jev and R2 disagree</option>
            <option value="agreement">Example where Jev and R2 agree</option>
          </select>
          <p className="w-full text-sm text-slate-400">{SCENARIO_DESCRIPTIONS[scenarioId]}</p>
        </div>
      ) : (
        <CustomForm transaction={transaction} setTransaction={setTransaction} psps={psps} setPsps={setPsps} onSubmit={handleSubmit} loading={loading} />
      )}

      {error && <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {mode === "preset" && <PresetView example={preset} />}
      {mode === "custom" && loading && <Stepper activeStep="calling_jev" live />}
      {mode === "custom" && result && <CustomResultView result={result} />}
    </div>
  );
}

function PresetView({ example }: { example: PresetExample }) {
  const disagreement = example.jevChoice !== example.r2Choice;
  return (
    <div>
      <Stepper activeStep="done" live={false} />
      <RouterLegend />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ChoiceCard label="R1" pspId={example.r1Choice} description={ROUTER_DESCRIPTIONS.R1} />
        <ChoiceCard label="R2" pspId={example.r2Choice} highlight={disagreement} description={ROUTER_DESCRIPTIONS.R2} />
        <ChoiceCard label="Jev" pspId={example.jevChoice} highlight={disagreement} description={ROUTER_DESCRIPTIONS.Jev} />
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">Jev confidence</div>
          <div className="mt-1 text-xl font-semibold text-slate-100">{example.jevConfidence?.toFixed(2) ?? "n/a"}</div>
        </div>
      </div>
      {disagreement && (
        <div className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-200">
          Jev and R2 disagree on this transaction: Jev picked <strong>{example.jevChoice}</strong>, R2 picked <strong>{example.r2Choice}</strong>.
        </div>
      )}

      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Jev probabilities</h3>
        <div className="flex gap-4 text-sm text-slate-300">
          {Object.entries(example.jevProbabilities).map(([id, p]) => (
            <span key={id}>
              {id}: {(p * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Simulated outcome per router&apos;s choice</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Object.entries(example.outcomesByPsp).map(([id, o]) => (
            <div key={id} className="rounded-lg border border-slate-800 p-3 text-sm">
              <div className="font-medium text-slate-200">{id}</div>
              <div className={o.authorized ? "text-emerald-400" : "text-red-400"}>{o.authorized ? "Authorized" : "Declined"}</div>
              <div className="text-slate-400">€{o.netCostEUR.toFixed(4)} net cost</div>
            </div>
          ))}
        </div>
      </div>

      <RawDataSection schema={example.schema} request={example.request} rawResponse={example.rawResponse} />
    </div>
  );
}

function CustomResultView({ result }: { result: CustomDecisionResult }) {
  if (result.status === "zero_eligible") {
    return <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">No eligible simulated PSP is available for this transaction.</div>;
  }
  if (result.status === "single_eligible") {
    return (
      <div>
        <Stepper activeStep="done" live />
        <p className="mb-3 text-slate-300">Only one PSP is eligible — routed deterministically, Jev skipped.</p>
        <ChoiceCard label="Route" pspId={result.chosenPspId} />
        <div className="mt-4 rounded-lg border border-slate-800 p-3 text-sm">
          <div className={result.outcome.authorized ? "text-emerald-400" : "text-red-400"}>{result.outcome.authorized ? "Authorized" : "Declined"}</div>
          <div className="text-slate-400">€{result.outcome.netCostEUR.toFixed(4)} net cost</div>
        </div>
      </div>
    );
  }

  const jev = result.jev;
  const disagreement = jev.status === "ok" && jev.choice !== result.r2Choice;

  return (
    <div>
      <Stepper activeStep="done" live />
      <RouterLegend />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ChoiceCard label="R1" pspId={result.r1Choice} description={ROUTER_DESCRIPTIONS.R1} />
        <ChoiceCard label="R2" pspId={result.r2Choice} highlight={disagreement} description={ROUTER_DESCRIPTIONS.R2} />
        {jev.status === "ok" ? (
          <ChoiceCard label="Jev" pspId={jev.choice} highlight={disagreement} description={ROUTER_DESCRIPTIONS.Jev} />
        ) : (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
            <div className="text-xs uppercase tracking-wide text-red-300">Jev</div>
            <div className="mt-1 text-sm text-red-300">{jev.status === "invalid" ? "Invalid choice" : "Unreachable"}</div>
          </div>
        )}
        {jev.status === "ok" && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-400">Jev confidence</div>
            <div className="mt-1 text-xl font-semibold text-slate-100">{jev.confidence?.toFixed(2) ?? "n/a"}</div>
          </div>
        )}
      </div>

      {disagreement && (
        <div className="mb-6 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-200">
          Jev and R2 disagree: Jev picked <strong>{(jev as { choice: string }).choice}</strong>, R2 picked <strong>{result.r2Choice}</strong>.
        </div>
      )}

      {jev.status === "ok" && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Jev probabilities</h3>
          <div className="flex gap-4 text-sm text-slate-300">
            {Object.entries(jev.probabilities).map(([id, p]) => (
              <span key={id}>
                {id}: {(p * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Simulated outcome per router&apos;s choice</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Object.entries(result.outcomesByPsp).map(([id, o]) => (
            <div key={id} className="rounded-lg border border-slate-800 p-3 text-sm">
              <div className="font-medium text-slate-200">{id}</div>
              <div className={o.authorized ? "text-emerald-400" : "text-red-400"}>{o.authorized ? "Authorized" : "Declined"}</div>
              <div className="text-slate-400">€{o.netCostEUR.toFixed(4)} net cost</div>
            </div>
          ))}
        </div>
      </div>

      {jev.status === "ok" && <RawDataSection schema={jev.schema} request={jev.request} rawResponse={jev.rawResponse} />}
    </div>
  );
}

function RawDataSection({ schema, request, rawResponse }: { schema: unknown; request: unknown; rawResponse: unknown }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {schema !== null && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Decision Schema</h3>
          <CopyableJson data={schema} />
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Sanitized request to Jev</h3>
        <CopyableJson data={request} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Raw response from Jev</h3>
        <CopyableJson data={rawResponse} />
      </div>
    </div>
  );
}

function CustomForm({
  transaction,
  setTransaction,
  psps,
  setPsps,
  onSubmit,
  loading,
}: {
  transaction: TransactionInput;
  setTransaction: (t: TransactionInput) => void;
  psps: PspInput[];
  setPsps: (p: PspInput[]) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  function updatePsp(id: string, field: keyof PspInput, value: number) {
    setPsps(psps.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  }

  return (
    <div className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-200">Transaction</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="text-xs text-slate-400">
          Amount
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={transaction.amount}
            onChange={(e) => setTransaction({ ...transaction, amount: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>
        <label className="text-xs text-slate-400">
          Currency
          <select
            value={transaction.currency}
            onChange={(e) => setTransaction({ ...transaction, currency: e.target.value as TransactionInput["currency"] })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          >
            {["EUR", "GBP", "USD"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Country
          <select
            value={transaction.country}
            onChange={(e) => setTransaction({ ...transaction, country: e.target.value as TransactionInput["country"] })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          >
            {["DE", "NL", "FR", "UK", "US"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Payment method
          <select
            value={transaction.paymentMethod}
            onChange={(e) => setTransaction({ ...transaction, paymentMethod: e.target.value as TransactionInput["paymentMethod"] })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          >
            {["card", "paypal", "sepa_debit"].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {transaction.paymentMethod === "card" && (
          <label className="text-xs text-slate-400">
            Card scheme
            <select
              value={transaction.cardScheme ?? "visa"}
              onChange={(e) => setTransaction({ ...transaction, cardScheme: e.target.value as TransactionInput["cardScheme"] })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
            >
              {["visa", "mastercard", "amex"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-slate-400">
          Device
          <select
            value={transaction.device}
            onChange={(e) => setTransaction({ ...transaction, device: e.target.value as TransactionInput["device"] })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          >
            {["desktop", "mobile"].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Customer
          <select
            value={transaction.customerType}
            onChange={(e) => setTransaction({ ...transaction, customerType: e.target.value as TransactionInput["customerType"] })}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          >
            {["new", "returning"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={transaction.threeDsEligible} onChange={(e) => setTransaction({ ...transaction, threeDsEligible: e.target.checked })} />
          3DS eligible
        </label>
      </div>

      <h2 className="mb-4 text-sm font-semibold text-slate-200">PSP stats</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {psps.map((psp) => (
          <div key={psp.id} className="rounded-lg border border-slate-800 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-slate-200">{psp.id}</span>
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input type="checkbox" checked={psp.enabled} onChange={(e) => setPsps(psps.map((p) => (p.id === psp.id ? { ...p, enabled: e.target.checked } : p)))} />
                enabled
              </label>
            </div>
            {(
              [
                ["acceptanceRate", "Acceptance rate", 0, 1, 0.001],
                ["transactionCostPercent", "Cost %", 0, 10, 0.1],
                ["fixedFee", "Fixed fee", 0, 10, 0.01],
                ["chargebackRate", "Chargeback rate", 0, 1, 0.0001],
                ["availabilityRate", "Availability", 0, 1, 0.001],
                ["latencyMs", "Latency ms", 1, 5000, 1],
                ["sampleSize", "Sample size", 0, 10000, 1],
              ] as const
            ).map(([field, label, min, max, step]) => (
              <label key={field} className="mb-1.5 block text-xs text-slate-400">
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={psp[field]}
                  onChange={(e) => updatePsp(psp.id, field, Number(e.target.value))}
                  className="mt-0.5 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                />
              </label>
            ))}
          </div>
        ))}
      </div>

      <button onClick={onSubmit} disabled={loading} className="mt-5 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50">
        {loading ? "Running…" : "Simulate"}
      </button>
    </div>
  );
}
