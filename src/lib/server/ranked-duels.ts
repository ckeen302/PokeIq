import "server-only";
import { pvpStore } from "./duel-store";
import type { PvpDuel } from "./duels";
import { rankedMatchOf, withRankedResult } from "./pokedle-duel";
import { RankedUnavailable, rankedStore, settleRanked } from "./ranked";

/**
 * Counts a ranked duel once it's over: the ratings move (once per duel, see
 * ranked.ts), then the duel records the change so both trainers see it.
 * Returns the duel as it now stands (unchanged if there was nothing to do,
 * or if the ratings couldn't be reached: the next poll tries again).
 */
export async function settleRankedDuel<D extends PvpDuel>(duel: D, rev: number): Promise<{ duel: D; rev: number }> {
  if (duel.kind !== "pokedle") return { duel, rev };
  const match = rankedMatchOf(duel);
  const store = match && rankedStore();
  if (!match || !store) return { duel, rev };
  try {
    const result = await settleRanked(match, store);
    const out = await pvpStore.update(duel.code, (d) => ({ ok: true as const, duel: d.kind === "pokedle" ? withRankedResult(d, result) : d }));
    return out.ok ? { duel: out.duel as D, rev: out.rev } : { duel, rev };
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[ranked] settling failed:", err);
    return { duel, rev };
  }
}
