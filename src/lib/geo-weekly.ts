/**
 * PokéGuessr's Weekly Challenge: one map a week, five rounds, the same
 * places for everyone. Weeks start on Monday 00:00 UTC; the map is a fixed
 * rotation over the region and themed maps, so a week's map never changes
 * and anyone can work it out (the places stay secret on the server).
 */

/** Week #1 starts on this Monday. */
export const GEO_WEEKLY_LAUNCH = "2026-10-26";
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The maps in turn, one a week: a themed map after every three regions.
 * Every id is a map in GEO_MAP_ORDER; one that can't be played is skipped
 * for the next in line (the server checks).
 */
export const GEO_WEEKLY_ROTATION = [
  "theme-gyms",
  "kanto",
  "johto",
  "hoenn",
  "theme-towns",
  "sinnoh",
  "unova",
  "kalos",
  "theme-routes",
  "alola",
  "galar",
  "paldea",
] as const;

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The Monday (YYYY-MM-DD, UTC) of the week `ms` falls in. */
export function geoWeekOf(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY_MS).toISOString().slice(0, 10);
}

/** A real Monday on or after launch. */
export function isGeoWeek(week: unknown): week is string {
  if (typeof week !== "string" || !WEEK_RE.test(week)) return false;
  const t = utc(week);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === week && new Date(t).getUTCDay() === 1 && t >= utc(GEO_WEEKLY_LAUNCH);
}

/** #1 for the launch week. */
export const geoWeeklyNumber = (week: string) => Math.round((utc(week) - utc(GEO_WEEKLY_LAUNCH)) / WEEK_MS) + 1;
/** When the week ends (the next Monday 00:00 UTC), in ms. */
export const geoWeeklyEndsAt = (week: string) => utc(week) + WEEK_MS;
/** The Monday of the week before. */
export const geoPreviousWeek = (week: string) => new Date(utc(week) - WEEK_MS).toISOString().slice(0, 10);

/** The maps a week can be played on, its own first, then the rest of the rotation in order (the server takes the first playable). */
export function geoWeeklyCandidates(week: string): string[] {
  const n = GEO_WEEKLY_ROTATION.length;
  const start = (((geoWeeklyNumber(week) - 1) % n) + n) % n;
  return Array.from({ length: n }, (_, i) => GEO_WEEKLY_ROTATION[(start + i) % n]);
}

/** The week's map among the maps on offer (`playable`: the ids that can be played). */
export function geoWeeklyMap(week: string, playable: (id: string) => boolean): string | null {
  return geoWeeklyCandidates(week).find(playable) ?? null;
}

/** The leaderboard key of a week's runs (geo_runs.mode). */
export const geoWeeklyBoard = (week: string) => `weekly:${week}`;
export const GEO_WEEKLY_BOARD_RE = /^weekly:(\d{4}-\d{2}-\d{2})$/;

/** "3d 4h", "5h 12m", "40m": time left until the week ends. */
export function geoWeeklyLeft(week: string, now: number): string {
  const ms = Math.max(0, geoWeeklyEndsAt(week) - now);
  const d = Math.floor(ms / DAY_MS);
  const h = Math.floor((ms % DAY_MS) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}
