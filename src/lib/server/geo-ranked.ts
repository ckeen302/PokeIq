import "server-only";
import { deriveSeed } from "./crypto";
import { RankedUnavailable, rankedStore, settleRanked, type RankedLadder } from "./ranked";
import { rankedMatchOf, withRankedResult, type Duel } from "./duel";
import { updateDuel } from "./duel-store";

/**
 * Ranked PokéGuessr on the server: one ladder per season (lib/geo-ranked.ts),
 * stored like ranked Pokédle's (ranked.ts) through its own tables and
 * functions (migration 0029_geo_ranked.sql), or in memory for tests and the
 * local E2E run. Without the migration there is no ranked PokéGuessr: the
 * card says so and casual duels carry on.
 */

/** A season's ladder. */
export const geoLadder = (season: string): RankedLadder => ({
  id: `geo:${season}`,
  fns: { apply: "geo_ranked_apply", standing: "geo_ranked_standing", top: "geo_ranked_top" },
  args: { p_season: season },
  migration: "0029_geo_ranked.sql",
});

export const geoRankedStore = (season: string) => rankedStore(geoLadder(season));

/** The key a trainer's PokéGuessr ratings are stored under (the same trainer every season): an HMAC of their identity. */
export const geoRankedKey = (identity: string) => deriveSeed("geo-ranked", identity);

/**
 * Counts a ranked duel once it's over: the ratings move (once per duel, see
 * ranked.ts), then the duel records the change so both trainers see it.
 * Returns the duel as it now stands (unchanged if there was nothing to do,
 * or if the ratings couldn't be reached: the next poll tries again).
 */
export async function settleGeoRankedDuel(duel: Duel, rev: number): Promise<{ duel: Duel; rev: number }> {
  const match = rankedMatchOf(duel);
  const store = match && geoRankedStore(match.season);
  if (!match || !store) return { duel, rev };
  try {
    const result = await settleRanked(match, store);
    const out = await updateDuel(duel.code, (d) => ({ ok: true as const, duel: withRankedResult(d, result) }));
    return out.ok ? { duel: out.duel, rev: out.rev } : { duel, rev };
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[geo-ranked] settling failed:", err);
    return { duel, rev };
  }
}
