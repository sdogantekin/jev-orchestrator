/** Section 9.2: scale and split. */
export const STREAM_LENGTH = 1000;
export const TRAIN_SLICE = { start: 0, end: 299 } as const; // inclusive
export const TEST_SLICE = { start: 300, end: 999 } as const; // inclusive
export const EVAL_SEED_COUNT = 20;

export function evalSeed(scenarioId: string, seedIndex: number): string {
  return `${scenarioId}|eval|${seedIndex}`;
}

/** A separate seed from the 20 evaluation seeds, used only for R2's training-slice tuning (section 6.2). */
export function tuningSeed(scenarioId: string): string {
  return `${scenarioId}|tuning`;
}
