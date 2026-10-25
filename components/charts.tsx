import { HypothesisBadge } from "./HypothesisBadge";

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export interface GroupedBarChartProps {
  groups: Array<{ label: string; values: Record<string, { value: number; lo?: number; hi?: number }> }>;
  series: SeriesSpec[];
  yFormat?: (v: number) => string;
  yMin?: number;
  yMax?: number;
  height?: number;
}

/** Grouped vertical bars with optional CI whiskers, direct value labels (required: several of
 * these series sit below 3:1 contrast on their own fill per the palette's relief rule), and a
 * legend. Plain SVG, no charting library. */
export function GroupedBarChart({ groups, series, yFormat = (v) => v.toFixed(2), yMin, yMax, height = 220 }: GroupedBarChartProps) {
  const allValues = groups.flatMap((g) => series.flatMap((s) => (g.values[s.key] ? [g.values[s.key]!.value, g.values[s.key]!.lo ?? g.values[s.key]!.value, g.values[s.key]!.hi ?? g.values[s.key]!.value] : [])));
  const lo = yMin ?? Math.min(...allValues, 0) * 0.98;
  const hi = yMax ?? Math.max(...allValues) * 1.04;

  const width = Math.max(560, groups.length * series.length * 46 + groups.length * 24);
  const marginLeft = 48;
  const marginBottom = 36;
  const plotHeight = height - marginBottom;
  const plotWidth = width - marginLeft - 16;
  const groupWidth = plotWidth / groups.length;
  const barWidth = Math.min(34, (groupWidth - 16) / series.length);

  const yScale = (v: number) => plotHeight - ((v - lo) / (hi - lo)) * plotHeight;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" className="font-sans">
        {/* gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = lo + f * (hi - lo);
          const y = yScale(v);
          return (
            <g key={f}>
              <line x1={marginLeft} x2={width - 8} y1={y} y2={y} stroke="#2d3748" strokeWidth={1} />
              <text x={marginLeft - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#8b98a8">
                {yFormat(v)}
              </text>
            </g>
          );
        })}

        {groups.map((group, gi) => {
          const groupX = marginLeft + gi * groupWidth;
          return (
            <g key={group.label}>
              {series.map((s, si) => {
                const entry = group.values[s.key];
                if (!entry) return null;
                const x = groupX + 8 + si * barWidth;
                const yTop = yScale(entry.value);
                const yBase = yScale(Math.max(lo, 0));
                const barH = Math.max(0, yBase - yTop);
                return (
                  <g key={s.key}>
                    <rect x={x} y={yTop} width={barWidth - 4} height={barH} fill={s.color} rx={2} />
                    {entry.lo !== undefined && entry.hi !== undefined && (
                      <line x1={x + (barWidth - 4) / 2} x2={x + (barWidth - 4) / 2} y1={yScale(entry.lo)} y2={yScale(entry.hi)} stroke="#e6edf3" strokeWidth={1.5} />
                    )}
                    <text x={x + (barWidth - 4) / 2} y={yTop - 5} textAnchor="middle" fontSize={9.5} fill="#e6edf3">
                      {yFormat(entry.value)}
                    </text>
                  </g>
                );
              })}
              <text x={groupX + groupWidth / 2} y={plotHeight + 18} textAnchor="middle" fontSize={11} fill="#c3c9d1">
                {group.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </div>
  );
}

export function Legend({ series }: { series: SeriesSpec[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-300">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export interface LineChartProps {
  series: Array<{ key: string; label: string; color: string; points: Array<{ x: number; y: number }> }>;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  height?: number;
  width?: number;
  yMin?: number;
  yMax?: number;
}

export function LineChart({ series, xFormat = (v) => v.toFixed(2), yFormat = (v) => v.toFixed(2), height = 220, width = 560, yMin, yMax }: LineChartProps) {
  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const xLo = Math.min(...allX);
  const xHi = Math.max(...allX);
  const yLo = yMin ?? Math.min(...allY, 0) * 0.98;
  const yHi = yMax ?? Math.max(...allY) * 1.05;

  const marginLeft = 48;
  const marginBottom = 28;
  const plotHeight = height - marginBottom;
  const plotWidth = width - marginLeft - 16;

  const xScale = (v: number) => marginLeft + ((v - xLo) / (xHi - xLo || 1)) * plotWidth;
  const yScale = (v: number) => plotHeight - ((v - yLo) / (yHi - yLo || 1)) * plotHeight;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" className="font-sans">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = yLo + f * (yHi - yLo);
          const y = yScale(v);
          return (
            <g key={f}>
              <line x1={marginLeft} x2={width - 8} y1={y} y2={y} stroke="#2d3748" strokeWidth={1} />
              <text x={marginLeft - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#8b98a8">
                {yFormat(v)}
              </text>
            </g>
          );
        })}
        {[xLo, (xLo + xHi) / 2, xHi].map((v) => (
          <text key={v} x={xScale(v)} y={plotHeight + 16} textAnchor="middle" fontSize={10} fill="#8b98a8">
            {xFormat(v)}
          </text>
        ))}
        {series.map((s) => {
          const path = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.x)},${yScale(p.y)}`).join(" ");
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} />
              {s.points.map((p) => (
                <circle key={p.x} cx={xScale(p.x)} cy={yScale(p.y)} r={3} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </div>
  );
}

export function StatTile({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      {sublabel && <div className="mt-1 text-xs text-slate-500">{sublabel}</div>}
    </div>
  );
}

export function ProportionBar({ segments }: { segments: Array<{ label: string; value: number; color: string }> }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded">
        {segments.map((seg) => (
          <div key={seg.label} style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }} title={`${seg.label}: ${seg.value}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-slate-300">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: seg.color }} />
            {seg.label}: {seg.value} ({((seg.value / total) * 100).toFixed(1)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

export function ChartSection({
  title,
  hypotheses,
  children,
}: {
  title: string;
  hypotheses?: Array<{ id: string; text: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        {hypotheses && hypotheses.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {hypotheses.map((h) => (
              <HypothesisBadge key={h.id} id={h.id} text={h.text} />
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export function SimpleTable({ columns, rows }: { columns: string[]; rows: Array<(string | number)[]> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left text-slate-400">
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800/60">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 text-slate-200">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
