/**
 * Ranked PokéGuessr seasons, client safe: when each season runs, how a
 * rating is softly reset when one ends, and what a season's peak division
 * earns. The server (lib/server/geo-ranked.ts) rolls the ladder over lazily,
 * on the first ranked action after a boundary, so nothing runs on a schedule.
 *
 * Seasons last eight weeks and start at 00:00 UTC on fixed dates: the ones
 * listed in GEO_SEASON_STARTS, then every eight weeks after the last one.
 */

import { GEO_DIVISIONS, GEO_ELO_START, type GeoDivisionId, geoDivisionOf } from "./geo-ranked";

export const GEO_SEASON_WEEKS = 8;
const WEEK_MS = 7 * 86_400_000;
const SEASON_MS = GEO_SEASON_WEEKS * WEEK_MS;

/** Season starts (UTC dates), oldest first. Add a date here to move a season; later ones follow every eight weeks. */
export const GEO_SEASON_STARTS: readonly string[] = ["2026-10-05"];

/** Seasons are named after the regions, in order; after Paldea they're numbered. */
const SEASON_NAMES = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];

export interface GeoSeason {
  /** 1 for the first season. */
  number: number;
  /** "Kanto Season". */
  name: string;
  /** UTC dates: the first day, and the day the next season starts. */
  start: string;
  end: string;
  startsAt: number;
  endsAt: number;
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const geoSeasonName = (n: number) => (SEASON_NAMES[n - 1] ? `${SEASON_NAMES[n - 1]} Season` : `Season ${n}`);

/** When season `n` (1-based) starts, in ms. */
export function geoSeasonStartMs(n: number): number {
  if (n <= GEO_SEASON_STARTS.length) return dayMs(GEO_SEASON_STARTS[n - 1]);
  return dayMs(GEO_SEASON_STARTS[GEO_SEASON_STARTS.length - 1]) + (n - GEO_SEASON_STARTS.length) * SEASON_MS;
}

/** Season `n` (1-based). */
export function geoSeason(n: number): GeoSeason {
  const startsAt = geoSeasonStartMs(n);
  const endsAt = geoSeasonStartMs(n + 1);
  return { number: n, name: geoSeasonName(n), start: dayOf(startsAt), end: dayOf(endsAt), startsAt, endsAt };
}

/** The season running at `ms`, or null before the first one. */
export function geoSeasonAt(ms: number): GeoSeason | null {
  if (ms < geoSeasonStartMs(1)) return null;
  let n = 1;
  while (n < GEO_SEASON_STARTS.length && ms >= geoSeasonStartMs(n + 1)) n++;
  if (n === GEO_SEASON_STARTS.length && ms >= geoSeasonStartMs(n + 1)) {
    n += Math.floor((ms - geoSeasonStartMs(n)) / SEASON_MS);
  }
  return geoSeason(n);
}

/** Every season's start date from the first up to `n` + 1 (where `n` ends), for the database's roll-over. */
export const geoSeasonStarts = (n: number) => Array.from({ length: n + 1 }, (_, i) => dayOf(geoSeasonStartMs(i + 1)));

// ---------------------------------------------------------------------------
// The soft reset
// ---------------------------------------------------------------------------

/** How much of a rating above the start survives a season's end. */
export const GEO_SEASON_KEEP = 0.5;

/**
 * A rating after its season ends: compressed halfway toward 1,000 (Showdown
 * and GeoGuessr style), but never below the floor of the division under the
 * one it finished in, so everybody drops at most one division and the order
 * of the ladder is kept (the reset never swaps two trainers). Never raises a
 * rating. The database's geo_ranked_season_reset does the same maths.
 */
export function geoSeasonReset(elo: number): number {
  const d = geoDivisionOf(elo);
  const below = GEO_DIVISIONS[Math.max(0, d.index - 1)].from;
  const compressed = GEO_ELO_START + Math.round(Math.max(0, elo - GEO_ELO_START) * GEO_SEASON_KEEP);
  return Math.min(elo, Math.max(compressed, below));
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/**
 * The reward track: reaching a division at any point in a season (its peak)
 * earns that division's rewards and every one below it, granted when the
 * season ends. Each is an unlock id other features read: `badge:` a season
 * badge (one per season, for the peak division), `ball:` a Poké Ball skin,
 * `emote:` a duel reaction, `trainer:` an item for the 3D trainer. The
 * cosmetics themselves are drawn elsewhere; here they are only ids and names.
 */
export const GEO_SEASON_TRACK: readonly { division: GeoDivisionId; rewards: readonly { id: string; label: string }[] }[] = [
  { division: "poke", rewards: [{ id: "emote:season-gg", label: "Season GG emote" }] },
  { division: "great", rewards: [{ id: "ball:great-season", label: "Great Ball pin skin" }] },
  { division: "ultra", rewards: [{ id: "ball:ultra-season", label: "Ultra Ball pin skin" }, { id: "emote:pinpoint", label: "Pinpoint emote" }] },
  { division: "master", rewards: [{ id: "ball:master-season", label: "Master Ball pin skin" }, { id: "trainer:explorer-cap", label: "Explorer cap" }] },
  { division: "beast", rewards: [{ id: "ball:beast-season", label: "Beast Ball pin skin" }, { id: "trainer:ultra-visor", label: "Ultra visor" }] },
];

/** A season badge's unlock id: "badge:guessr-s1-master". */
export const geoSeasonBadge = (season: number, division: GeoDivisionId) => `badge:guessr-s${season}-${division}`;

const DIVISION_ORDER = GEO_DIVISIONS.map((d) => d.id) as GeoDivisionId[];

/**
 * Every unlock a season's peak division earns: its badge, then the track's
 * rewards up to and including that division. The single source of truth for
 * season rewards: anything that grants or checks a cosmetic reads this (or
 * geoSeasonUnlocks for a trainer's whole history).
 */
export function geoSeasonRewards(season: number, peak: GeoDivisionId): string[] {
  const top = DIVISION_ORDER.indexOf(peak);
  return [geoSeasonBadge(season, peak), ...GEO_SEASON_TRACK.filter((t) => DIVISION_ORDER.indexOf(t.division) <= top).flatMap((t) => t.rewards.map((r) => r.id))];
}

/** Every unlock a trainer has from their finished seasons (no duplicates, in the order earned). */
export function geoSeasonUnlocks(records: readonly Pick<GeoSeasonRecord, "season" | "peakDivision">[]): string[] {
  const out = new Set<string>();
  for (const r of [...records].sort((a, b) => a.season - b.season)) for (const id of geoSeasonRewards(r.season, r.peakDivision)) out.add(id);
  return [...out];
}

/** A reward's display name ("Kanto Season Master Ball badge"), or the id itself if unknown. */
export function geoRewardLabel(id: string): string {
  const badge = /^badge:guessr-s(\d+)-(\w+)$/.exec(id);
  if (badge) {
    const d = GEO_DIVISIONS.find((x) => x.id === badge[2]);
    return `${geoSeasonName(Number(badge[1]))} ${d?.name ?? badge[2]} badge`;
  }
  for (const t of GEO_SEASON_TRACK) for (const r of t.rewards) if (r.id === id) return r.label;
  return id;
}

// ---------------------------------------------------------------------------
// What the API carries
// ---------------------------------------------------------------------------

/** A finished season on a trainer's record. */
export interface GeoSeasonRecord {
  season: number;
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** The rating when the season ended (before the reset). */
  finalElo: number;
  peakElo: number;
  peakDivision: GeoDivisionId;
  /** What the peak earned (geoSeasonRewards). */
  rewards: string[];
}

/** The current season so far for one trainer. */
export interface GeoSeasonProgress {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** The highest rating after a duel this season, or null before the first. */
  peakElo: number | null;
}

/** The season as /api/geo/ranked returns it. `you` and `history` are missing while season records are off here. */
export interface GeoSeasonView {
  number: number;
  name: string;
  startsAt: number;
  endsAt: number;
  you?: GeoSeasonProgress | null;
  history?: GeoSeasonRecord[];
}

/** "32 days left", "5 hours left", "Ends in 12 minutes". */
export function geoSeasonTimeLeft(endsAt: number, now: number): string {
  const ms = Math.max(0, endsAt - now);
  const days = Math.floor(ms / 86_400_000);
  if (days >= 2) return `${days} days left`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 2) return `${hours} hours left`;
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"} left`;
}
