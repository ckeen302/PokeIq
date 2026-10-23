import type { RankedLeaderRow, RankedStanding } from "@/lib/ranked";

/**
 * Ranked PokéConnections, client-safe. It is the Pokédle ladder (the same
 * Elo, Poké Ball to Master Ball tiers and provisional games, see lib/ranked)
 * with a separate rating per trainer and a new ladder every calendar month:
 * everyone starts the season at 1,000.
 */

/** The ranked queue's matchmaking settings. */
export const CONN_RANKED_MATCH = { game: "connections", ranked: true };
export const CONN_RANKED_QUEUE_KEY = "connections:ranked";

/** "2026-10": the season a moment falls in (UTC months). */
export const connSeasonOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
export const SEASON_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "October 2026". */
export function connSeasonLabel(season: string): string {
  return new Date(`${season}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** When a season ends (the first moment of the next month, UTC). */
export function connSeasonEnd(season: string): number {
  const d = new Date(`${season}-01T00:00:00Z`);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** GET /api/connections/ranked[?top=1]: the season, your standing and the ladder. */
export type ConnRankedResponse =
  | { available: false; id?: string; season: string }
  | { available: true; id?: string; season: string; endsAt: number; you: RankedStanding | null; top?: RankedLeaderRow[] };

/** A ranked duel as its players see it: each seat's rating going in, and once counted, before and after. */
export interface ConnDuelRanked {
  season: string;
  ratings: number[];
  provisional: boolean[];
  result?: { before: number[]; after: number[] };
}
