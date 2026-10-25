import { ChartSection, GroupedBarChart, LineChart, ProportionBar, SimpleTable, StatTile } from "../../components/charts";
import { HYPOTHESES, HYPOTHESES_V2, hypotheses, loadAllResults } from "../../lib/results/loadResults";
import { OpenOnHypothesisHash } from "../../components/HypothesisBadge";
import { TEST_SETUP_ID, hypothesisAnchor } from "../../lib/content/hypothesisLinks";
import { SCENARIO_IDS } from "../../lib/simulation/scenarios";
import { DEFAULT_JEV_MODEL } from "../../lib/jev/config";
import { EVAL_SEED_COUNT, SENSITIVITY_SEED_COUNT } from "../../lib/experiments/seeds";
import { ROUTER_DESCRIPTIONS, SCENARIO_DESCRIPTIONS } from "../../lib/content/glossary";

export const metadata = { title: "Results — Payment Decision Lab" };

const COLORS = { R0: "#3987e5", R1: "#d95926", R2: "#199e70", Jev: "#c98500", JevV1: "#7a5a1e", Oracle: "#94a3b8", FollowData: "#9b7be0", Stats: "#9b7be0" };
const SCENARIO_LABELS: Record<string, string> = {
  stable: "Stable",
  drift: "Drift",
  thin_data: "Thin data",
  cold_start: "Cold start",
  conflicting_objectives: "Conflicting objectives",
  eligibility_mix: "Eligibility mix",
};

/** Experiment 1 verdicts, as reported in EXPERIMENT.md Section 8. */
const V1_VERDICTS: Record<string, { label: string; tone: "good" | "bad" | "mixed" }> = {
  "EXP1-H1": { label: "Supported", tone: "good" },
  "EXP1-H2": { label: "Weakly contradicted: R2 is 0.70pp ahead on Stable", tone: "bad" },
  "EXP1-H3": { label: "Not supported: the gap was larger on thin data and cold start", tone: "bad" },
  "EXP1-H4": { label: "Supported, with a nuance on auditability", tone: "mixed" },
  "EXP1-H5": { label: "Supported", tone: "good" },
};

const TONE_CLASS = { good: "text-emerald-400", bad: "text-rose-400", mixed: "text-amber-300" } as const;

function HypothesisItem({ id, text, verdict, tone }: { id: string; text: string; verdict: string; tone: keyof typeof TONE_CLASS }) {
  return (
    <li
      id={hypothesisAnchor(id)}
      className="scroll-mt-32 rounded-lg p-2 transition-colors duration-500 data-[highlight=true]:bg-indigo-500/15 data-[highlight=true]:ring-1 data-[highlight=true]:ring-indigo-400/60"
    >
      <div className="text-sm text-slate-200">
        <span className="mr-2 whitespace-nowrap rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-300">{id}</span>
        {text}
      </div>
      <div className={`mt-1 text-sm ${TONE_CLASS[tone]}`}>{verdict}</div>
    </li>
  );
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/** Expected-authorization differences are a few tenths of a point, so they need two decimals. */
function pct2(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function pp(ci: { mean: number; lo: number; hi: number }): string {
  const f = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}`;
  return `${f(ci.mean)} [${f(ci.lo)}, ${f(ci.hi)}]`;
}

export default function ResultsPage() {
  const { ruleResults, jevMainResults, dataRichness, sensitivity, calibration, probes, v1Diagnosis, v2DesignCheck, jevV2Results } = loadAllResults();

  const diagnosisGroups = SCENARIO_IDS.map((id) => {
    const d = v1Diagnosis[id];
    return {
      label: SCENARIO_LABELS[id] ?? id,
      values: { Oracle: { value: d.oracle }, R1: { value: d.R1 }, R0: { value: d.R0 }, FollowData: { value: d.followSegment }, Jev: { value: d.jev } },
    };
  });
  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const errV1 = avg(SCENARIO_IDS.map((id) => v2DesignCheck.scenarios[id].v1.observedErrorSegmentPp));
  const errV2 = avg(SCENARIO_IDS.map((id) => v2DesignCheck.scenarios[id].v2.observedErrorSegmentPp));
  const nV1 = v2DesignCheck.scenarios.stable.v1.medianSegmentSampleSize;
  const nV2 = v2DesignCheck.scenarios.stable.v2.medianSegmentSampleSize;
  const jevFollows = avg(SCENARIO_IDS.map((id) => v1Diagnosis[id].jevPicksHighestObservedOverall));

  const v2Groups = SCENARIO_IDS.map((id) => {
    const e = jevV2Results[id].expectedAuth;
    const ci = (c: { mean: number; lo: number; hi: number }) => ({ value: c.mean, lo: c.lo, hi: c.hi });
    return {
      label: SCENARIO_LABELS[id] ?? id,
      values: { JevV1: ci(e.jevV1), Jev: ci(e.jev), R1: ci(e.R1), R2: ci(e.R2), Stats: ci(e.statsReference) },
    };
  });
  const v2DiffRows = SCENARIO_IDS.map((id) => {
    const m = jevV2Results[id].jevMinus;
    return [SCENARIO_LABELS[id] ?? id, pp(m.jevV1), pp(m.R1), pp(m.R2), pp(m.statsReference)];
  });

  // Verdicts computed from the data with the exact pass rules committed in docs/hypotheses-v2.md.
  const minus = (id: (typeof SCENARIO_IDS)[number]) => jevV2Results[id].jevMinus;
  const v2Verdicts: Record<string, { supported: boolean; evidence: string }> = {
    "EXP2-H1": {
      supported: SCENARIO_IDS.filter((id) => minus(id).jevV1.lo > 0).length >= 5,
      evidence: `Jev gained ${(Math.min(...SCENARIO_IDS.map((id) => minus(id).jevV1.mean)) * 100).toFixed(2)} to ${(Math.max(...SCENARIO_IDS.map((id) => minus(id).jevV1.mean)) * 100).toFixed(2)} points, CI above zero in ${SCENARIO_IDS.filter((id) => minus(id).jevV1.lo > 0).length} of 6 scenarios.`,
    },
    "EXP2-H2": { supported: minus("stable").R1.hi >= 0, evidence: `Stable: Jev − R1 = ${pp(minus("stable").R1)}.` },
    "EXP2-H3": { supported: minus("drift").R1.lo > 0 && minus("drift").R2.lo > 0, evidence: `Drift: Jev − R1 = ${pp(minus("drift").R1)}, Jev − R2 = ${pp(minus("drift").R2)}.` },
    "EXP2-H4": { supported: minus("cold_start").R1.hi < 0, evidence: `Cold start: Jev − R1 = ${pp(minus("cold_start").R1)}.` },
    "EXP2-H5": {
      supported: SCENARIO_IDS.every((id) => minus(id).statsReference.lo <= 0),
      evidence: `Jev − statistics reference: ${SCENARIO_IDS.map((id) => `${SCENARIO_LABELS[id]} ${(minus(id).statsReference.mean * 100).toFixed(2)}`).join(", ")} points.`,
    },
  };

  const authGroups = SCENARIO_IDS.map((id) => ({
    label: SCENARIO_LABELS[id] ?? id,
    values: {
      R0: { value: ruleResults[id].metrics.R0.authorizationRate.mean, lo: ruleResults[id].metrics.R0.authorizationRate.lo, hi: ruleResults[id].metrics.R0.authorizationRate.hi },
      R1: { value: ruleResults[id].metrics.R1.authorizationRate.mean, lo: ruleResults[id].metrics.R1.authorizationRate.lo, hi: ruleResults[id].metrics.R1.authorizationRate.hi },
      R2: { value: ruleResults[id].metrics.R2.authorizationRate.mean, lo: ruleResults[id].metrics.R2.authorizationRate.lo, hi: ruleResults[id].metrics.R2.authorizationRate.hi },
      Jev: { value: jevMainResults[id].summary.jevAuthorizationRate.mean, lo: jevMainResults[id].summary.jevAuthorizationRate.lo, hi: jevMainResults[id].summary.jevAuthorizationRate.hi },
    },
  }));

  const costGroups = SCENARIO_IDS.map((id) => ({
    label: SCENARIO_LABELS[id] ?? id,
    values: {
      R0: { value: ruleResults[id].metrics.R0.netCostPerAuthorized.mean },
      R1: { value: ruleResults[id].metrics.R1.netCostPerAuthorized.mean },
      R2: { value: ruleResults[id].metrics.R2.netCostPerAuthorized.mean },
      Jev: { value: jevMainResults[id].summary.jevNetCostPerAuthorized.mean },
    },
  }));

  const disagreementGroups = SCENARIO_IDS.map((id) => ({
    label: SCENARIO_LABELS[id] ?? id,
    values: { Rate: { value: jevMainResults[id].summary.disagreementRate } },
  }));

  const richnessAuthGroups = (["stable", "drift"] as const).map((id) => {
    const r = dataRichness[id];
    return {
      label: SCENARIO_LABELS[id] ?? id,
      values: Object.fromEntries(
        r.levelSummaries.map((s) => [`L${s.level}`, { value: s.authorizationRate.mean, lo: s.authorizationRate.lo, hi: s.authorizationRate.hi }])
      ),
    };
  });

  const sensitivityRows = Object.entries(sensitivity)
    .filter(([key]) => key !== "baseline")
    .map(([variant, data]) => {
      const v = data as { gapPp: number; baselineGapPp: number; flipped: boolean; jevAuth: { mean: number }; r2Auth: { mean: number } };
      return [variant, pct(v.jevAuth.mean), pct(v.r2Auth.mean), `${v.gapPp.toFixed(2)}pp`, v.flipped ? "YES" : "no"];
    });

  const responsivenessPoints = probes.responsiveness.rows.reduce<Map<number, number[]>>((map, row) => {
    const arr = map.get(row.acceptanceStep) ?? [];
    arr.push(row.sweptPspProbability);
    map.set(row.acceptanceStep, arr);
    return map;
  }, new Map());
  const responsivenessLinePoints = [...responsivenessPoints.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, values]) => ({ x, y: values.reduce((s, v) => s + v, 0) / values.length }));

  const calibrationPoints = calibration.curve
    .filter((b) => b.meanStatedProbability !== null)
    .map((b) => ({ x: b.meanStatedProbability!, y: b.empiricalBestRate! }));

  const irrelevanceVariants = [...new Set(probes.irrelevance.rows.map((r) => r.variant))];
  const irrelevanceAllConsistent = irrelevanceVariants.every((v) => {
    const choices = new Set(probes.irrelevance.rows.filter((r) => r.variant === v).map((r) => r.choice));
    return choices.size === 1;
  });
  const baselineChoice = probes.irrelevance.rows.find((r) => r.variant === "baseline")?.choice;
  const allVariantsSameAsBaseline = irrelevanceVariants.every((v) => {
    const row = probes.irrelevance.rows.find((r) => r.variant === v);
    return row?.choice === baselineChoice;
  });

  const repeatConfidences = probes.repeatability.rows.map((r) => r.confidence).filter((c): c is number => c !== undefined);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-100">Results</h1>
      <p className="mb-6 max-w-3xl text-slate-400">
        Precomputed findings from two experiments: {EVAL_SEED_COUNT} seeds per scenario for each main comparison, {SENSITIVITY_SEED_COUNT} seeds for the
        sensitivity check, model <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{DEFAULT_JEV_MODEL}</code>, pinned in both. Hover a badge
        for the hypothesis it tests. Numbers are seeded and reproducible from the configs in <code className="rounded bg-slate-800 px-1.5 py-0.5">experiments/config/</code>.
      </p>

      <section className="mb-8 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">The verdict: it depends on the data</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>
            <span className="font-medium text-slate-100">Experiment 1: Jev lost.</span> Every rule router beat it in every scenario, including R0, which always
            picks the same PSP.
          </li>
          <li>
            <span className="font-medium text-slate-100">Why: the data was too noisy.</span> Each PSP&apos;s per-segment numbers came from a handful of past
            payments and were off by ~{errV1.toFixed(1)} points, more than the real differences between PSPs. Jev takes the numbers at face value; the rules won by
            ignoring them.
          </li>
          <li>
            <span className="font-medium text-slate-100">Experiment 2: with 20× more data, Jev roughly ties the rules.</span> It wins when a PSP degrades or is
            new, loses when one segment is thin, and mostly matches a simple statistics formula. Every difference is a few tenths of a point.
          </li>
        </ol>
        <p className="mt-3 text-sm text-slate-400">
          Either way, Jev still costs money and latency per decision, where rules are free and instant. Not a strong alternative to rules in these tests; a
          credible one with good data.
        </p>
      </section>

      <details id={TEST_SETUP_ID} className="group/setup mb-8 rounded-xl border border-slate-800 bg-slate-900/40">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-5 [&::-webkit-details-marker]:hidden">
          <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 shrink-0 fill-current text-slate-400 transition-transform group-open/setup:rotate-90">
            <path d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4z" />
          </svg>
          <span>
            <span className="block text-lg font-semibold text-slate-100">How the test was set up</span>
            <span className="block text-sm text-slate-400">Hypotheses · Routers · Scenarios</span>
          </span>
        </summary>
        <OpenOnHypothesisHash />
        <div className="space-y-8 border-t border-slate-800 p-5">
          <div>
            <h2 className="mb-1 text-base font-semibold text-slate-200">Hypotheses</h2>
            <p className="mb-3 text-sm text-slate-400">Written down before each experiment ran. The badges on the charts below refer to these.</p>
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-300">Experiment 1</h3>
                <ul className="space-y-1">
                  {Object.entries(HYPOTHESES).map(([id, text]) => (
                    <HypothesisItem key={id} id={id} text={text} verdict={V1_VERDICTS[id]!.label} tone={V1_VERDICTS[id]!.tone} />
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-300">Experiment 2</h3>
                <ul className="space-y-1">
                  {Object.entries(HYPOTHESES_V2).map(([id, h]) => (
                    <HypothesisItem
                      key={id}
                      id={id}
                      text={h.text}
                      verdict={v2Verdicts[id]!.supported ? "Supported" : "Not supported"}
                      tone={v2Verdicts[id]!.supported ? "good" : "bad"}
                    />
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 text-base font-semibold text-slate-200">Routers</h2>
              <dl className="space-y-2 text-sm">
                {(["R0", "R1", "R2", "Jev"] as const).map((key) => (
                  <div key={key}>
                    <dt className="font-medium" style={{ color: COLORS[key] }}>
                      {key === "Jev" ? "R3 Jev" : key}
                    </dt>
                    <dd className="text-slate-400">{ROUTER_DESCRIPTIONS[key]}</dd>
                  </div>
                ))}
                <div>
                  <dt className="font-medium" style={{ color: COLORS.Stats }}>
                    Statistics reference (Experiment 2)
                  </dt>
                  <dd className="text-slate-400">
                    A yardstick, not a competitor: blends each PSP&apos;s segment and overall acceptance by how much data is behind them, then picks the highest.
                  </dd>
                </div>
              </dl>
            </div>
            <div>
              <h2 className="mb-2 text-base font-semibold text-slate-200">Scenarios</h2>
              <dl className="space-y-2 text-sm">
                {SCENARIO_IDS.map((id) => (
                  <div key={id}>
                    <dt className="font-medium text-slate-200">{SCENARIO_LABELS[id]}</dt>
                    <dd className="text-slate-400">{SCENARIO_DESCRIPTIONS[id]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </details>

      <h2 className="mb-4 mt-2 text-xl font-semibold text-slate-100">Experiment 1: the original test</h2>

      <ChartSection title="Authorization rate by scenario and router" hypotheses={hypotheses("EXP1-H2", "EXP1-H3")}>
        <p className="mb-3 text-sm text-slate-400">
          95% bootstrap confidence intervals (shown as whiskers), {ruleResults.stable.decisionCount.toLocaleString()} decisions per bar.
        </p>
        <GroupedBarChart
          groups={authGroups}
          series={[
            { key: "R0", label: "R0 Naive", color: COLORS.R0 },
            { key: "R1", label: "R1 Hand-tuned", color: COLORS.R1 },
            { key: "R2", label: "R2 Tuned", color: COLORS.R2 },
            { key: "Jev", label: "R3 Jev", color: COLORS.Jev },
          ]}
          yFormat={pct}
          yMin={0.9}
          yMax={0.97}
        />
        <p className="mt-3 text-sm text-slate-300">
          R2 beats Jev&apos;s authorization rate in every scenario (0.70–1.36 points), significantly so (non-overlapping CIs) in 4 of 6. EXP1-H3 predicted
          Jev might have an edge in thin_data/cold_start; instead the gap there is as large or larger than on stable.
        </p>
        <p className="mt-2 text-sm text-slate-300">
          Read across all four bars, too. R0, R1 and R2 are within about half a point of each other. R2&apos;s tuning didn&apos;t make it reliably better than R1
          (it&apos;s below R1 in 4 of 6 scenarios). Jev is below all three, including R0, which ignores the data entirely. The next section explains why.
        </p>
      </ChartSection>

      <ChartSection title="Why Jev lost: the observed data was noisier than the signal">
        <p className="mb-3 text-sm text-slate-400">
          A diagnosis made after Experiment 1&apos;s results, using no new calls: the recorded answers are replayed, and each router is scored by{" "}
          <span className="text-slate-200">expected authorization</span>, the true probability that its chosen PSP authorizes. That removes coin-flip luck.
          &quot;Follow the data&quot; picks whichever PSP has the highest observed segment acceptance.
        </p>
        <GroupedBarChart
          groups={diagnosisGroups}
          series={[
            { key: "Oracle", label: "Oracle (knows the truth)", color: COLORS.Oracle },
            { key: "R1", label: "R1 Hand-tuned", color: COLORS.R1 },
            { key: "R0", label: "R0 Always Alpha", color: COLORS.R0 },
            { key: "FollowData", label: "Follow the data", color: COLORS.FollowData },
            { key: "Jev", label: "R3 Jev", color: COLORS.Jev },
          ]}
          yFormat={pct2}
          yMin={0.92}
          yMax={0.97}
        />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Room to win" value={`${((v1Diagnosis.stable.oracle - v1Diagnosis.stable.R1) * 100).toFixed(2)}pp`} sublabel="oracle over R1, stable" />
          <StatTile label="Past payments per segment" value={String(nV1)} sublabel="median, behind each PSP's segment rate" />
          <StatTile label="Segment rate error" value={`${errV1.toFixed(1)}pp`} sublabel="average, vs 1.5–2.5pp real PSP gaps" />
          <StatTile label="Jev follows the data" value={`${(jevFollows * 100).toFixed(0)}%`} sublabel={`picks the highest observed acceptance; ${Math.min(...SCENARIO_IDS.map((id) => v1Diagnosis[id].jevPicksHighestObservedOverall * 100)).toFixed(0)}–${Math.max(...SCENARIO_IDS.map((id) => v1Diagnosis[id].jevPicksHighestObservedOverall * 100)).toFixed(0)}% by scenario`} />
        </div>
        <p className="mt-3 text-sm text-slate-300">
          In every scenario, following the data scores below R0, which ignores it: the numbers are too noisy to trust. Jev mostly follows them, and doesn&apos;t
          discount small samples, so it inherits the noise. Jev&apos;s preference for acceptance over fee (see the trade-off probe and calibration chart below)
          explains its cost results, not this authorization gap.
        </p>
      </ChartSection>

      <h2 className="mb-2 mt-10 text-xl font-semibold text-slate-100">Experiment 2: the same test with 20× more data</h2>
      <p className="mb-4 max-w-3xl text-sm text-slate-400">
        Predictions were written down before any Jev call. One change: each PSP&apos;s
        observed numbers come from {v2DesignCheck.highVolume.perTransaction}× more past payments. Median segment sample {nV1} → {nV2}; segment rate error{" "}
        {errV1.toFixed(1)} → {errV2.toFixed(1)} points. Same world, scenarios, transactions, seeds and model. R2 retuned on the new data. 84,000 live calls,
        all successful.
      </p>

      <ChartSection title="Expected authorization rate with good data" hypotheses={hypotheses("EXP2-H1", "EXP2-H2", "EXP2-H3", "EXP2-H4", "EXP2-H5")}>
        <p className="mb-3 text-sm text-slate-400">
          Expected authorization (true approval probability of each choice), {jevV2Results.stable.expectedAuth.jev.n.toLocaleString()} decisions per bar, 95%
          paired bootstrap CIs. &quot;Jev, Exp. 1&quot; is the same model on the same transactions with Experiment 1&apos;s data. The statistics reference blends
          segment and overall acceptance by sample size; it&apos;s a yardstick, not a competitor.
        </p>
        <GroupedBarChart
          groups={v2Groups}
          series={[
            { key: "JevV1", label: "Jev, Exp. 1 data", color: COLORS.JevV1 },
            { key: "Jev", label: "Jev, Exp. 2 data", color: COLORS.Jev },
            { key: "R1", label: "R1 Hand-tuned", color: COLORS.R1 },
            { key: "R2", label: "R2 Tuned", color: COLORS.R2 },
            { key: "Stats", label: "Statistics reference", color: COLORS.Stats },
          ]}
          yFormat={pct2}
          yMin={0.92}
          yMax={0.97}
        />
        <div className="mt-5">
          <SimpleTable columns={["Scenario (Jev minus…, points)", "Jev, Exp. 1", "R1", "R2", "Statistics ref."]} rows={v2DiffRows} />
        </div>
        <p className="mt-3 text-sm text-slate-300">
          More data lifts Jev by about a point everywhere. It now ties R1 on stable, beats both rule sets on drift and cold start, and loses on thin data. Against
          the simple statistics formula it is level or slightly behind everywhere except cold start. Realized (coin-flip) authorization rates can&apos;t separate
          any of these differences; their CIs all overlap.
        </p>
      </ChartSection>

      <ChartSection title="Experiment 2: hypothesis verdicts">
        <SimpleTable
          columns={["ID", "Hypothesis", "Supported if", "Verdict", "Evidence"]}
          rows={Object.entries(HYPOTHESES_V2).map(([id, h]) => [id.replace("-", "\u2011"), h.text, h.supportedIf, v2Verdicts[id]!.supported ? "✅ Supported" : "❌ Not supported", v2Verdicts[id]!.evidence])}
        />
        <p className="mt-3 text-sm text-slate-300">
          Caveats: on drift Jev beats the rules but only ties R0, because this world degrades the PSP that &quot;always Alpha&quot; mostly avoids. And a router
          that knows the truth still beats R1 by only ~0.5 points, so every win and loss here is small.
        </p>
      </ChartSection>

      <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-100">More detail from Experiment 1</h2>

      <ChartSection title="Net cost per authorized transaction" hypotheses={hypotheses("EXP1-H2")}>
        <GroupedBarChart
          groups={costGroups}
          series={[
            { key: "R0", label: "R0 Naive", color: COLORS.R0 },
            { key: "R1", label: "R1 Hand-tuned", color: COLORS.R1 },
            { key: "R2", label: "R2 Tuned", color: COLORS.R2 },
            { key: "Jev", label: "R3 Jev", color: COLORS.Jev },
          ]}
          yFormat={(v) => `€${v.toFixed(2)}`}
        />
      </ChartSection>

      <ChartSection title="Disagreement rate between Jev and R2, and who wins on disagreement" hypotheses={hypotheses("EXP1-H2")}>
        <GroupedBarChart groups={disagreementGroups} series={[{ key: "Rate", label: "Disagreement rate", color: COLORS.Jev }]} yFormat={pct} yMin={0} yMax={0.6} />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIO_IDS.map((id) => {
            const d = jevMainResults[id].summary.onDisagreement;
            return (
              <div key={id} className="rounded-lg border border-slate-800 p-3">
                <div className="mb-2 text-sm font-medium text-slate-200">{SCENARIO_LABELS[id]}</div>
                <ProportionBar
                  segments={[
                    { label: "Jev wins", value: d.jevWins, color: COLORS.Jev },
                    { label: "R2 wins", value: d.r2Wins, color: COLORS.R2 },
                    { label: "Ties", value: d.ties, color: "#64748b" },
                  ]}
                />
              </div>
            );
          })}
        </div>
      </ChartSection>

      <ChartSection title="Jev decision cost and latency" hypotheses={hypotheses("EXP1-H4")}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Avg call latency" value={`${jevMainResults.stable.summary.jevAverageCallLatencyMs.toFixed(0)}ms`} sublabel="vs ~0ms for a rule" />
          <StatTile label="Worst call latency" value={`${jevMainResults.stable.summary.jevWorstCallLatencyMs.toFixed(0)}ms`} />
          <StatTile label="Avg cost / live call" value={`$${jevMainResults.stable.summary.jevAverageCostPerLiveCall.toFixed(6)}`} sublabel="vs $0 for a rule" />
          <StatTile label="Invalid / failed / fallback" value="0 / 0 / 0" sublabel="across all 84,000 main-comparison decisions" />
        </div>
      </ChartSection>

      <ChartSection title="Data richness: does more observed history change the outcome?" hypotheses={hypotheses("EXP1-H1")}>
        <p className="mb-3 text-sm text-slate-400">Levels 1 (overall only), 2 (+ segment stats), 3 (+ last 20 same-segment outcomes). Same 20 seeds.</p>
        <GroupedBarChart
          groups={richnessAuthGroups}
          series={[
            { key: "L1", label: "Level 1", color: COLORS.R0 },
            { key: "L2", label: "Level 2 (default)", color: COLORS.R2 },
            { key: "L3", label: "Level 3", color: COLORS.Jev },
          ]}
          yFormat={pct}
          yMin={0.9}
          yMax={0.96}
        />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(["stable", "drift"] as const).map((id) => {
            const r = dataRichness[id];
            return (
              <div key={id} className="text-sm text-slate-300">
                <div className="mb-1 font-medium text-slate-200">{SCENARIO_LABELS[id]}</div>
                <div>Choice changed 1→2: {((r.choiceDiff12 / r.n) * 100).toFixed(1)}%</div>
                <div>Choice changed 2→3: {((r.choiceDiff23 / r.n) * 100).toFixed(1)}%</div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-slate-300">
          Authorization rate is statistically indistinguishable across all three levels in both scenarios, but the underlying choice shifts a lot from
          level 1→2 and comparatively little from 2→3 — level 2&apos;s summarized segment stats capture most of what matters.
        </p>
      </ChartSection>

      <ChartSection title="Sensitivity check: does the conclusion hold under a perturbed world design?" hypotheses={hypotheses("EXP1-H2")}>
        <p className="mb-3 text-sm text-slate-400">
          Stable scenario only, {SENSITIVITY_SEED_COUNT} seeds per variant (fewer than the main results — a robustness check, not a main-table number).
        </p>
        <SimpleTable columns={["Variant", "Jev auth", "R2 auth", "Gap (R2−Jev)", "Conclusion flipped?"]} rows={sensitivityRows} />
        <p className="mt-3 text-sm text-slate-300">None of the 9 variants flipped the direction: R2 beat Jev in every one.</p>
      </ChartSection>

      <ChartSection title="Probe: responsiveness" hypotheses={hypotheses("EXP1-H1")}>
        <p className="mb-3 text-sm text-slate-400">
          One PSP&apos;s observed acceptance swept from below to above a fixed competitor&apos;s value ({probes.responsiveness.fixedCompetitorId} at{" "}
          {probes.responsiveness.fixedCompetitorAcceptance}), holding everything else fixed. Mean of 3 repeated calls per step.
        </p>
        <LineChart
          series={[{ key: "p", label: `P(choose ${probes.responsiveness.sweptPspId})`, color: COLORS.Jev, points: responsivenessLinePoints }]}
          xFormat={(v) => v.toFixed(2)}
          yFormat={pct}
          yMin={0}
          yMax={1}
        />
      </ChartSection>

      <ChartSection title="Probe: trade-off" hypotheses={hypotheses("EXP1-H1")}>
        <p className="mb-3 text-sm text-slate-400">
          {probes.tradeOff.expensivePspId} (higher acceptance, higher fee) vs {probes.tradeOff.cheapPspId} (lower acceptance, lower fee), a 1-point
          acceptance gap. Small amount (€10) and large amount (€800), 5 repeats each.
        </p>
        <SimpleTable
          columns={["Amount", "Choices across 5 repeats"]}
          rows={["small", "large"].map((bucket) => [
            bucket,
            probes.tradeOff.rows
              .filter((r) => r.amountBucket === bucket)
              .map((r) => r.choice)
              .join(", "),
          ])}
        />
        <p className="mt-3 text-sm text-slate-300">
          Jev picked the higher-acceptance, pricier option every time, at both amounts — no small-amount-prefers-cheap effect at this acceptance gap.
        </p>
      </ChartSection>

      <ChartSection title="Probe: irrelevance" hypotheses={hypotheses("EXP1-H5")}>
        <p className="mb-3 text-sm text-slate-400">5 harmless variations (shuffled PSP order, renamed display names, reordered metric glossary, an added unrelated field), 3 repeats each.</p>
        <SimpleTable
          columns={["Variant", "Choices across 3 repeats"]}
          rows={irrelevanceVariants.map((v) => [v, probes.irrelevance.rows.filter((r) => r.variant === v).map((r) => r.choice).join(", ")])}
        />
        <p className="mt-3 text-sm text-slate-300">
          {irrelevanceAllConsistent && allVariantsSameAsBaseline
            ? "Every variant stayed consistent with the baseline choice — a clean pass."
            : "Some variation in choice was observed across variants."}
        </p>
      </ChartSection>

      <ChartSection title="Probe: repeatability" hypotheses={hypotheses("EXP1-H5")}>
        <p className="mb-3 text-sm text-slate-400">Same state, 20 independent live calls.</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatTile label="Distinct choices" value={String(probes.repeatability.distinctChoiceCount)} sublabel="out of 20 calls" />
          <StatTile label="Confidence range" value={`${Math.min(...repeatConfidences).toFixed(2)}–${Math.max(...repeatConfidences).toFixed(2)}`} />
          <StatTile label="Mean confidence" value={(repeatConfidences.reduce((s, v) => s + v, 0) / repeatConfidences.length).toFixed(3)} />
        </div>
      </ChartSection>

      <ChartSection title="Calibration: when Jev states probability p for a PSP, how often is it actually the best option?" hypotheses={hypotheses("EXP1-H1", "EXP1-H4")}>
        <p className="mb-3 text-sm text-slate-400">
          Derived from the main comparison&apos;s {calibration.samplesUsed.toLocaleString()} (PSP, probability) samples — &quot;best&quot; means the
          ground-truth best PSP among the eligible set for that transaction (section 9.1&apos;s rule), not simple authorization.
        </p>
        <LineChart series={[{ key: "cal", label: "Empirical best-rate", color: COLORS.R2, points: calibrationPoints }]} xFormat={pct} yFormat={pct} yMin={0} yMax={0.6} />
        <p className="mt-3 text-sm text-slate-300">
          Not a calibration curve in the usual sense — the rate falls as stated probability rises through most of the range. This traces back to the
          trade-off probe: because most eligible PSPs here authorize, &quot;actually best&quot; is usually decided by cost, while Jev weights
          acceptance far more heavily than cost. High Jev confidence often loses to a cheaper alternative on this ground truth.
        </p>
      </ChartSection>
    </div>
  );
}
