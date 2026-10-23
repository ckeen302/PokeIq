import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { connSeasonOf } from "@/lib/connections/ranked";
import { RankedUnavailable, memoryRankedStore, settleRanked, supabaseRankedStore, type RankedMatch, type RankedStore } from "./ranked";
import { deriveSeed } from "./crypto";
import type { ConnectionsDuel } from "./connections-duel";

/**
 * Ranked PokéConnections ratings: Pokédle's rating system (./ranked: the
 * same Elo, the same once-per-duel settling) kept apart, one ladder per
 * month. Ratings live in Supabase (`connections_ratings` and
 * `connections_ranked_matches`, migration 0031), or in memory with
 * POKEIQ_LOCAL_ACCOUNTS=1 and in development without Supabase. Before the
 * migration is applied there is no ranked play: callers get null (or
 * RankedUnavailable) and the page offers casual duels only.
 */

/** A trainer's rating key here: Pokédle's identity, hashed again so the two ladders never share a key. */
export const connRankedKey = (identity: string) => deriveSeed("connections-ranked", identity);

/** The store for one season's ladder, or null where there is none. */
export function connRankedStore(season = connSeasonOf(Date.now())): RankedStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryRankedStore(`connections:${season}`);
  const sb = getServiceSupabase();
  if (sb) return supabaseRankedStore(sb, { prefix: "connections_ranked", season });
  return process.env.NODE_ENV !== "production" ? memoryRankedStore(`connections:${season}`) : null;
}

/** What a ranked duel remembers of how its trainers met. */
export interface ConnRankedInfo {
  season: string;
  /** Each seat's rating key. */
  keys: [string, string];
  /** Each seat's rating and ranked games going in. */
  ratings: [number, number];
  games: [number, number];
  /** Set once the duel has been counted. */
  result?: { before: [number, number]; after: [number, number] };
}

/** A finished ranked duel that hasn't been counted yet: what counting it needs. Null otherwise. */
export function connRankedMatchOf(duel: ConnectionsDuel): RankedMatch | null {
  if (!duel.ranked || duel.ranked.result || duel.status !== "finished" || !duel.end || duel.players.length !== 2) return null;
  return {
    code: duel.code,
    keys: duel.ranked.keys,
    names: [duel.players[0].name, duel.players[1].name],
    reason: duel.end.reason,
    winner: duel.end.winner,
  };
}

/** Records how a ranked duel was counted (once: a later call changes nothing). */
export function withConnRankedResult(duel: ConnectionsDuel, result: { before: [number, number]; after: [number, number] }): ConnectionsDuel {
  if (!duel.ranked || duel.ranked.result) return duel;
  return { ...duel, ranked: { ...duel.ranked, result } };
}

/** Counts a finished ranked duel in its season's ladder, once. Null when the ratings can't be reached. */
export async function settleConnRanked(duel: ConnectionsDuel): Promise<{ before: [number, number]; after: [number, number] } | null> {
  const match = connRankedMatchOf(duel);
  const store = match && duel.ranked && connRankedStore(duel.ranked.season);
  if (!match || !store) return null;
  try {
    return await settleRanked(match, store);
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[connections-ranked] settling failed:", err);
    return null;
  }
}
