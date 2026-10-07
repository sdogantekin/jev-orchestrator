export interface WeightedOption<T extends string> {
  value: T;
  weight: number;
}

/** Deterministic weighted choice from a [0, 1) draw. */
export function weightedChoice<T extends string>(u: number, options: ReadonlyArray<WeightedOption<T>>): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  const target = u * total;
  let cumulative = 0;
  for (const option of options) {
    cumulative += option.weight;
    if (target < cumulative) return option.value;
  }
  return options[options.length - 1]!.value;
}
