/**
 * Ranked PokéGuessr: head-to-head duels on the world map, every game, with
 * the same Elo and Poké Ball to Master Ball tiers as ranked Pokédle
 * (lib/ranked.ts), on a ladder of its own that starts again every month.
 *
 * A season is a calendar month in UTC ("2026-10"). Everyone starts each
 * season at 1,000; a duel counts in the season it was matched in.
 */

const SEASON_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The season a moment falls in: "2026-10". */
export function geoSeasonOf(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const isGeoSeason = (s: unknown): s is string => typeof s === "string" && SEASON_RE.test(s);

/** "October 2026". */
export function geoSeasonName(season: string): string {
  const m = SEASON_RE.exec(season);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : season;
}

/** When a season ends (the first moment of the next month, UTC). */
export function geoSeasonEnd(season: string): number {
  const m = SEASON_RE.exec(season);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]), 1);
}

/** The season before this one. */
export function previousGeoSeason(season: string): string {
  const m = SEASON_RE.exec(season);
  if (!m) return season;
  return geoSeasonOf(Date.UTC(Number(m[1]), Number(m[2]) - 2, 15));
}

/** Whole days left in a season (rounded up; 0 once it's over). */
export function geoSeasonDaysLeft(season: string, now: number): number {
  return Math.max(0, Math.ceil((geoSeasonEnd(season) - now) / 86_400_000));
}

/** Ranked is played on the whole world, every game. */
export const GEO_RANKED_REGION = "world";
/** The ranked queue's matchmaking settings. */
export const GEO_RANKED_MATCH = { game: "geo", region: GEO_RANKED_REGION, ranked: true } as const;

/** A ranked duel, as each trainer sees it: the season, each seat's rating going in, and once counted, before and after. */
export interface GeoDuelRankedView {
  season: string;
  ratings: [number, number];
  provisional: [boolean, boolean];
  result?: { before: [number, number]; after: [number, number] };
}
