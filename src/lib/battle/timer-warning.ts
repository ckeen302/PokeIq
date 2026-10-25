/** Showdown-style warnings as your turn's time runs low: at 30 and 10 seconds left. */
export const TIMER_WARNINGS = [30_000, 10_000] as const;

/** The warning to show with `left` ms to choose (null: none yet, or no clock running). */
export function timerWarning(left: number | null): string | null {
  if (left === null || left <= 0) return null;
  if (left <= TIMER_WARNINGS[1]) return `${Math.ceil(left / 1000)} seconds left!`;
  if (left <= TIMER_WARNINGS[0]) return `${Math.ceil(left / 1000)} seconds left to choose.`;
  return null;
}
