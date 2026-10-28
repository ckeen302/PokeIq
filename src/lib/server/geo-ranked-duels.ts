import "server-only";
import { updateDuel } from "./duel-store";
import { geoRankedMatchOf, withGeoRankedResult, type Duel } from "./duel";
import { geoRankedStore, settleGeoRanked } from "./geo-ranked";
import { RankedUnavailable } from "./ranked";

/**
 * Counts a ranked PokéGuessr duel once it's over: the ratings move (once per
 * duel, see geo-ranked.ts), then the duel records the change so both
 * trainers see it. Returns the duel as it now stands (unchanged if there
 * was nothing to do, or if the ratings couldn't be reached: the next poll
 * tries again).
 */
export async function settleGeoRankedDuel(duel: Duel, rev: number): Promise<{ duel: Duel; rev: number }> {
  const match = geoRankedMatchOf(duel);
  const store = match && geoRankedStore();
  if (!match || !store) return { duel, rev };
  try {
    const result = await settleGeoRanked(match, store);
    const out = await updateDuel(duel.code, (d) => ({ ok: true as const, duel: withGeoRankedResult(d, result) }));
    return out.ok ? { duel: out.duel, rev: out.rev } : { duel, rev };
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[geo-ranked] settling failed:", err);
    return { duel, rev };
  }
}
