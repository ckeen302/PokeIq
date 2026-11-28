import type { Run } from "@/lib/nuzlocke/run";

/**
 * A run started (or copied) in a browser that won't save: handed to the run page in memory, across the client-side
 * navigation, so the player can still play it this visit (the page says it isn't being saved).
 */
let pending: Run | null = null;

export function handOff(run: Run) {
  pending = run;
}

export function takeHandOff(id: string): Run | null {
  if (pending?.id !== id) return null;
  const run = pending;
  pending = null;
  return run;
}
