import { ChartSection, GroupedBarChart, LineChart, ProportionBar, SimpleTable, StatTile } from "../../components/charts";
import { hypotheses, loadAllResults } from "../../lib/results/loadResults";
import { SCENARIO_IDS } from "../../lib/simulation/scenarios";
import { DEFAULT_JEV_MODEL } from "../../lib/jev/config";
import { EVAL_SEED_COUNT, SENSITIVITY_SEED_COUNT } from "../../lib/experiments/seeds";
import { ROUTER_DESCRIPTIONS, SCENARIO_DESCRIPTIONS } from "../../lib/content/glossary";

export const metadata = { title: "Results — Payment Decision Lab" };

const COLORS = { R0: "#3987e5", R1: "#d95926", R2: "#199e70", Jev: "#c98500" };
const SCENARIO_LABELS: Record<string, string> = {
  stable: "Stable",
  drift: "Drift",
  thin_data: "Thin data",
  cold_start: "Cold start",
  conflicting_objectives: "Conflicting objectives",
  eligibility_mix: "Eligibility mix",
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export default function ResultsPage() {
  const { ruleResults, jevMainResults, dataRichness, sensitivity, calibration, probes } = loadAllResults();

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
      <p className="mb-8 max-w-3xl text-slate-400">
        Precomputed findings from the full experiment: {EVAL_SEED_COUNT} seeds per scenario for the main comparison, {SENSITIVITY_SEED_COUNT} seeds for the
        sensitivity check, model <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{DEFAULT_JEV_MODEL}</code>, pinned. Hover a badge for
        the hypothesis it tests. Numbers are seeded and reproducible from the configs in <code className="rounded bg-slate-800 px-1.5 py-0.5">experiments/config/</code>.
      </p>

      <div className="mb-8 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Routers</h2>
          <dl className="space-y-2 text-sm">
            {(["R0", "R1", "R2", "Jev"] as const).map((key) => (
              <div key={key}>
                <dt className="font-medium" style={{ color: COLORS[key] }}>
                  {key === "Jev" ? "R3 Jev" : key}
                </dt>
                <dd className="text-slate-400">{ROUTER_DESCRIPTIONS[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Scenarios</h2>
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

      <ChartSection title="Authorization rate by scenario and router" hypotheses={hypotheses("H2", "H3")}>
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
          R2 beats Jev&apos;s authorization rate in every scenario (0.70–1.36 points), significantly so (non-overlapping CIs) in 4 of 6. H3 predicted
          Jev might have an edge in thin_data/cold_start; instead the gap there is as large or larger than on stable.
        </p>
      </ChartSection>

      <ChartSection title="Net cost per authorized transaction" hypotheses={hypotheses("H2")}>
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

      <ChartSection title="Disagreement rate between Jev and R2, and who wins on disagreement" hypotheses={hypotheses("H2")}>
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

      <ChartSection title="Jev decision cost and latency" hypotheses={hypotheses("H4")}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Avg call latency" value={`${jevMainResults.stable.summary.jevAverageCallLatencyMs.toFixed(0)}ms`} sublabel="vs ~0ms for a rule" />
          <StatTile label="Worst call latency" value={`${jevMainResults.stable.summary.jevWorstCallLatencyMs.toFixed(0)}ms`} />
          <StatTile label="Avg cost / live call" value={`$${jevMainResults.stable.summary.jevAverageCostPerLiveCall.toFixed(6)}`} sublabel="vs $0 for a rule" />
          <StatTile label="Invalid / failed / fallback" value="0 / 0 / 0" sublabel="across all 84,000 main-comparison decisions" />
        </div>
      </ChartSection>

      <ChartSection title="Data richness: does more observed history change the outcome?" hypotheses={hypotheses("H1")}>
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

      <ChartSection title="Sensitivity check: does the conclusion hold under a perturbed world design?" hypotheses={hypotheses("H2")}>
        <p className="mb-3 text-sm text-slate-400">
          Stable scenario only, {SENSITIVITY_SEED_COUNT} seeds per variant (fewer than the main results — a robustness check, not a main-table number).
        </p>
        <SimpleTable columns={["Variant", "Jev auth", "R2 auth", "Gap (R2−Jev)", "Conclusion flipped?"]} rows={sensitivityRows} />
        <p className="mt-3 text-sm text-slate-300">None of the 9 variants flipped the direction: R2 beat Jev in every one.</p>
      </ChartSection>

      <ChartSection title="Probe: responsiveness" hypotheses={hypotheses("H1")}>
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

      <ChartSection title="Probe: trade-off" hypotheses={hypotheses("H1")}>
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

      <ChartSection title="Probe: irrelevance" hypotheses={hypotheses("H5")}>
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

      <ChartSection title="Probe: repeatability" hypotheses={hypotheses("H5")}>
        <p className="mb-3 text-sm text-slate-400">Same state, 20 independent live calls.</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatTile label="Distinct choices" value={String(probes.repeatability.distinctChoiceCount)} sublabel="out of 20 calls" />
          <StatTile label="Confidence range" value={`${Math.min(...repeatConfidences).toFixed(2)}–${Math.max(...repeatConfidences).toFixed(2)}`} />
          <StatTile label="Mean confidence" value={(repeatConfidences.reduce((s, v) => s + v, 0) / repeatConfidences.length).toFixed(3)} />
        </div>
      </ChartSection>

      <ChartSection title="Calibration: when Jev states probability p for a PSP, how often is it actually the best option?" hypotheses={hypotheses("H1", "H4")}>
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
