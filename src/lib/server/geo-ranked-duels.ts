import "server-only";
import { updateDuel } from "./duel-store";
import { geoRankedMatchOf, withGeoRankedResult, type Duel } from "./duel";
import { geoRankedStore, settleGeoRanked } from "./geo-ranked";
import { RankedUnavailable } from "./ranked";
import { publishIfChanged } from "./geo-duel-live";

/**
 * Counts a ranked PokéGuessr duel once it's over: the ratings move (once per
 * duel, see geo-ranked.ts), then the duel records the change so both
 * trainers see it, and both pages hear of it over the duel's channel.
 * Returns the duel as it now stands (unchanged if there was nothing to do,
 * or if the ratings couldn't be reached: the next poll tries again).
 */
export async function settleGeoRankedDuel(duel: Duel, rev: number): Promise<{ duel: Duel; rev: number }> {
  const match = geoRankedMatchOf(duel);
  const store = match && geoRankedStore();
  if (!match || !store) return { duel, rev };
  try {
    const result = await settleGeoRanked(match, store);
    let before: Duel | undefined;
    const out = await updateDuel(duel.code, (d) => {
      before = d;
      return { ok: true as const, duel: withGeoRankedResult(d, result) };
    });
    if (!out.ok) return { duel, rev };
    publishIfChanged(duel.code, before, out.duel, out.rev);
    return { duel: out.duel, rev: out.rev };
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[geo-ranked] settling failed:", err);
    return { duel, rev };
  }
}
