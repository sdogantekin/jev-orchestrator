/** Section 9.2: scale and split. */
export const STREAM_LENGTH = 1000;
export const TRAIN_SLICE = { start: 0, end: 299 } as const; // inclusive
export const TEST_SLICE = { start: 300, end: 999 } as const; // inclusive
export const EVAL_SEED_COUNT = 20;

export function evalSeed(scenarioId: string, seedIndex: number): string {
  return `${scenarioId}|eval|${seedIndex}`;
}

/**
 * Separate seeds from the 20 evaluation seeds, used only for R2's training-slice tuning
 * (section 6.2). Scoring a parameter combination by its pooled result across several tuning
 * seeds (rather than one) reduces overfitting to a single stream's sampling noise, while still
 * never touching the evaluation seeds or the test slice.
 */
export const TUNING_SEED_COUNT = 5;

export function tuningSeeds(scenarioId: string): string[] {
  return Array.from({ length: TUNING_SEED_COUNT }, (_, i) => `${scenarioId}|tuning|${i + 1}`);
}

/** Section 9.2/9.6: sensitivity runs use 5 seeds on Stable only, distinct from eval and tuning seeds. */
export const SENSITIVITY_SEED_COUNT = 5;

export function sensitivitySeed(scenarioId: string, variantName: string, seedIndex: number): string {
  return `${scenarioId}|sensitivity|${variantName}|${seedIndex}`;
}
