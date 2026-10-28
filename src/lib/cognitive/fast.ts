/**
 * Test hook: with localStorage "pokeiq:iq-test:fast" set to "1" (the E2E
 * smoke test sets it), the clocks run short so a whole test takes seconds.
 * Scores from such a run are not sent to the norm store.
 */
export const FAST_KEY = "pokeiq:iq-test:fast";

export function fastMode(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(FAST_KEY) === "1";
  } catch {
    return false;
  }
}

/** An item or section clock, shortened in fast mode. */
export function clockMs(ms: number, fast = fastMode()): number {
  return fast ? Math.min(ms, 4000) : ms;
}
