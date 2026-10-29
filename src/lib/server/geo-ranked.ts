import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import {
  GEO_ELO_START,
  GEO_RANKED_BOT_AFTER_S_DEFAULT,
  GEO_RANKED_BOT_K_SCALE,
  GEO_RANKED_SHOCK_DIFF_DEFAULT,
  geoDecayedElo,
  geoDivisionOf,
  geoMatchScores,
  geoRateDuel,
  utcDay,
  GEO_DIVISIONS,
  type GeoRankedLeaderRow,
  type GeoRankedStanding,
  type GeoRatingRules,
} from "@/lib/geo-ranked";
import {
  GEO_SEASON_KEEP,
  geoSeason,
  geoSeasonAt,
  geoSeasonName,
  geoSeasonReset,
  geoSeasonRewards,
  geoSeasonStarts,
  geoSeasonUnlocks,
  type GeoSeason,
  type GeoSeasonProgress,
  type GeoSeasonRecord,
  type GeoSeasonView,
} from "@/lib/geo-seasons";
import { deriveSeed } from "./crypto";
import { RankedUnavailable } from "./ranked";

/**
 * Ranked PokéGuessr on the server: one Elo per trainer (lib/geo-ranked.ts
 * has the rules), changed once per finished ranked duel.
 *
 * A trainer is who ranked Pokédle says they are (ranked.ts: their account,
 * or the signed anonymous id their browser holds), hashed again under this
 * ladder's own purpose so the two never share a key.
 *
 * Decay is lazy: a rating is read as it stands today (every day since its
 * last game decayed), a standing read writes that back, and counting a
 * duel starts from the decayed value. Counting is one database function
 * that, in one transaction, records the duel under its code (a second write
 * changes nothing and returns the first), checks both ratings are still the
 * ones the change was computed from, and moves them on; so every duel
 * counts exactly once whatever polls race. The Gym Leader bot has no row:
 * a bot duel records the bot's Elo on the match and moves the trainer only.
 *
 * Ratings live in Supabase (`geo_ranked`, `geo_ranked_matches`; migration
 * 0043), or in memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E
 * run) and in development without Supabase. Before the migration is applied
 * there is no ranked PokéGuessr: callers get null and casual duels carry on.
 */

/** The key a trainer's PokéGuessr rating is stored under: an HMAC of their ranked identity. */
export const geoRankedKey = (identity: string) => deriveSeed("geo-ranked", identity);

// ---------------------------------------------------------------------------
// Configuration (environment)
// ---------------------------------------------------------------------------

const envNumber = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export interface GeoRankedConfig extends GeoRatingRules {
  /** The widest Elo gap matchmaking ever allows (0: unlimited). */
  maxDiff: number;
  /** Seconds in the queue before the Gym Leader is offered (0: never). */
  botAfterS: number;
}

/** The ladder's tunables, read from the environment on each call (cheap, and tests can change them). */
export function geoRankedConfig(): GeoRankedConfig {
  return {
    shockDiff: envNumber("POKEIQ_GEO_RANKED_SHOCK_DIFF", GEO_RANKED_SHOCK_DIFF_DEFAULT),
    maxDiff: envNumber("POKEIQ_GEO_RANKED_MAX_DIFF", 0),
    botAfterS: envNumber("POKEIQ_GEO_RANKED_BOT_AFTER_S", GEO_RANKED_BOT_AFTER_S_DEFAULT),
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** A rating as it stands on a day: the Elo (decayed to that day) and the ranked games before it. */
export interface GeoRatingState {
  elo: number;
  games: number;
}

export interface GeoApplyInput {
  code: string;
  /** The UTC day the duel ended on. */
  today: string;
  /** Seat 1 is null for the Gym Leader bot. */
  keys: [string, string | null];
  names: [string, string];
  /** The ratings the change was computed from (the bot's: its fixed Elo, no games). */
  expect: [GeoRatingState, GeoRatingState];
  after: [number, number];
  scores: [number, number];
  /** Each seat's points over the duel's rounds (for best score). */
  points: [number, number];
}

export type GeoApplyOutcome =
  /** Recorded now, or already recorded for this duel: the match as it was counted. */
  | { status: "applied" | "done"; keys: [string, string | null]; before: [number, number]; after: [number, number] }
  /** A rating moved since it was read: compute again from these. */
  | { status: "stale"; current: [GeoRatingState, GeoRatingState] };

export interface GeoRankedStore {
  /** The trainer's rating as of `today`, or null before a first game. Reads only. */
  rating(key: string, today: string): Promise<GeoRatingState | null>;
  /** Their standing as of `today` (writes the decay back). Null for an unknown trainer. */
  standing(key: string, today: string): Promise<GeoRankedStanding | null>;
  /** The top of the ladder as of `today`, hidden Elos blanked. */
  top(limit: number, today: string): Promise<GeoRankedLeaderRow[]>;
  apply(input: GeoApplyInput): Promise<GeoApplyOutcome>;
  /**
   * Seasons (lib/geo-seasons.ts): brings every rating into `season`. Each
   * trainer whose rating belongs to an earlier season has that season
   * archived (if they played in it) and is softly reset. Idempotent; returns
   * how many were reset. Throws SeasonsUnavailable before migration 0049.
   */
  rollSeason(season: number, today: string): Promise<number>;
  /** A trainer's record in a season so far (null for an unknown trainer). */
  seasonProgress(key: string, season: GeoSeason): Promise<GeoSeasonProgress | null>;
  /** A trainer's finished seasons, newest first. */
  seasonHistory(key: string): Promise<GeoSeasonRecord[]>;
}

/** Season records aren't stored here yet (migration 0049 hasn't been applied): ranked carries on without them. */
export class SeasonsUnavailable extends Error {}

const LADDER_MAX = 100;

/** The ladder row the client sees: the Elo only where the division shows it. */
function leaderRow(position: number, p: { name: string; elo: number; games: number; wins: number; losses: number }): GeoRankedLeaderRow {
  const division = geoDivisionOf(p.elo);
  return { position, name: p.name, elo: division.showElo ? p.elo : null, division: division.id, games: p.games, wins: p.wins, losses: p.losses };
}

// ---- memory -------------------------------------------------------------------

interface MemoryPlayer {
  name: string;
  elo: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  bestScore: number;
  day: string | null;
  gamesToday: number;
  /** The UTC day the row was made, and the season its rating belongs to (unset: the one it was made in). */
  created: string;
  season?: number;
}

interface MemoryMatch {
  keys: [string, string | null];
  before: [number, number];
  after: [number, number];
  scores: [number, number];
  day: string;
}

interface MemoryDb {
  players: Map<string, MemoryPlayer>;
  matches: Map<string, MemoryMatch>;
  seasons: Map<string, GeoSeasonRecord[]>;
}

const globalStore = globalThis as unknown as { __pokeiqGeoRanked?: MemoryDb };

const blankPlayer = (name: string, today: string): MemoryPlayer => ({ name, elo: GEO_ELO_START, games: 0, wins: 0, losses: 0, draws: 0, bestScore: 0, day: null, gamesToday: 0, created: today });

/** The season a UTC day falls in (0 before the first). */
const seasonOfDay = (day: string) => geoSeasonAt(Date.parse(`${day}T00:00:00Z`))?.number ?? 0;

/** A trainer's games, record and peak between two UTC days (from inclusive, to exclusive). */
function progressFrom(matches: Iterable<MemoryMatch>, key: string, from: string, to: string): GeoSeasonProgress {
  const out: GeoSeasonProgress = { games: 0, wins: 0, losses: 0, draws: 0, peakElo: null };
  for (const m of matches) {
    const seat: 0 | 1 | -1 = m.keys[0] === key ? 0 : m.keys[1] === key ? 1 : -1;
    if (seat === -1) continue;
    if (m.day < from || m.day >= to) continue;
    out.games++;
    const s = m.scores[seat];
    if (s === 1) out.wins++;
    else if (s === 0) out.losses++;
    else out.draws++;
    out.peakElo = Math.max(out.peakElo ?? 0, m.after[seat]);
  }
  return out;
}

/** Brings a player's row to `today`: the decay since their last game applied, that day closed. */
function catchUp(p: MemoryPlayer, today: string): MemoryPlayer {
  if (!p.day || p.day >= today) return p;
  return { ...p, elo: geoDecayedElo(p, today), day: today, gamesToday: 0 };
}

export function memoryGeoRankedStore(): GeoRankedStore {
  const db = (globalStore.__pokeiqGeoRanked ??= { players: new Map(), matches: new Map(), seasons: new Map() });
  const ladder = (today: string) =>
    [...db.players.values()]
      .filter((p) => p.games > 0)
      .map((p) => catchUp(p, today))
      .sort((a, b) => b.elo - a.elo || b.games - a.games || a.name.localeCompare(b.name));
  const current = (key: string, name: string, today: string): MemoryPlayer => catchUp(db.players.get(key) ?? blankPlayer(name, today), today);
  return {
    async rating(key, today) {
      const p = db.players.get(key);
      if (!p) return null;
      const c = catchUp(p, today);
      return { elo: c.elo, games: c.games };
    },
    async standing(key, today) {
      const p = db.players.get(key);
      if (!p) return null;
      const c = catchUp(p, today);
      db.players.set(key, c);
      const all = ladder(today);
      return {
        elo: c.elo,
        games: c.games,
        wins: c.wins,
        losses: c.losses,
        draws: c.draws,
        bestScore: c.bestScore,
        position: c.games > 0 ? all.filter((q) => q.elo > c.elo).length + 1 : null,
        players: all.length,
      };
    },
    async top(limit, today) {
      return ladder(today)
        .slice(0, Math.min(limit, LADDER_MAX))
        .map((p, i) => leaderRow(i + 1, p));
    },
    async apply(input) {
      const done = db.matches.get(input.code);
      if (done) return { status: "done", ...done };
      const bot = input.keys[1] === null;
      const players = input.keys.map((k, i) => (k === null ? null : current(k, input.names[i], input.today)));
      const now = players.map((p, i) => (p ? { elo: p.elo, games: p.games } : { elo: input.expect[i].elo, games: 0 })) as [GeoRatingState, GeoRatingState];
      if (now.some((c, i) => c.elo !== input.expect[i].elo || c.games !== input.expect[i].games)) return { status: "stale", current: now };
      players.forEach((p, i) => {
        if (!p) return;
        const s = input.scores[i];
        p.elo = input.after[i];
        p.games += 1;
        p.name = input.names[i];
        if (s === 1) p.wins += 1;
        else if (s === 0.5) p.draws += 1;
        else p.losses += 1;
        p.bestScore = Math.max(p.bestScore, input.points[i]);
        p.gamesToday = p.day === input.today ? p.gamesToday + 1 : 1;
        p.day = input.today;
        db.players.set(input.keys[i]!, p);
      });
      const match = { keys: input.keys, before: [now[0].elo, now[1].elo] as [number, number], after: bot ? ([input.after[0], now[1].elo] as [number, number]) : input.after };
      db.matches.set(input.code, { ...match, scores: input.scores, day: input.today });
      return { status: "applied", ...match };
    },
    async rollSeason(season, today) {
      let reset = 0;
      for (const [key, p] of db.players) {
        const was = Math.min(season, p.season ?? (p.created ? seasonOfDay(p.created) : season));
        if (was >= season) {
          p.season = season;
          continue;
        }
        if (was >= 1) {
          const s = geoSeason(was);
          const stats = progressFrom(db.matches.values(), key, s.start, s.end);
          const list: GeoSeasonRecord[] = db.seasons.get(key) ?? [];
          if (stats.games > 0 && stats.peakElo !== null && !list.some((r) => r.season === was)) {
            const peakDivision = geoDivisionOf(stats.peakElo).id;
            list.push({
              season: was,
              name: geoSeasonName(was),
              games: stats.games,
              wins: stats.wins,
              losses: stats.losses,
              draws: stats.draws,
              finalElo: p.day && p.day < s.end ? geoDecayedElo(p, s.end) : p.elo,
              peakElo: stats.peakElo,
              peakDivision,
              rewards: geoSeasonRewards(was, peakDivision),
            });
            db.seasons.set(key, list);
          }
        }
        db.players.set(key, { ...p, elo: geoSeasonReset(catchUp(p, today).elo), day: null, gamesToday: 0, season });
        reset++;
      }
      return reset;
    },
    async seasonProgress(key, season) {
      if (!db.players.has(key)) return null;
      return progressFrom(db.matches.values(), key, season.start, season.end);
    },
    async seasonHistory(key) {
      return [...(db.seasons.get(key) ?? [])].sort((a, b) => b.season - a.season);
    },
  };
}

/** Forgets every rating in memory (tests). */
export function clearMemoryGeoRanked() {
  globalStore.__pokeiqGeoRanked = undefined;
  clearGeoSeasonRoll();
}

// ---- Supabase -------------------------------------------------------------------

/** The tables or functions aren't there (the migration hasn't been applied). */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
/** After finding them missing, look again this much later (so applying the migration needs no redeploy). */
const RECHECK_MS = 60_000;
let missingUntil = 0;

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    if (Date.now() >= missingUntil) console.warn("[geo-ranked] ranked PokéGuessr is off until migration 0043_geo_ranked.sql is applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new RankedUnavailable(error.message);
  }
  throw new Error(error.message);
}

/** The season table or functions aren't there yet (migration 0049), or the season column isn't (42703). */
const SEASON_MISSING = new Set([...MISSING, "42703"]);
let seasonsMissingLogged = false;
function seasonCheck(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (SEASON_MISSING.has(error.code ?? "")) {
    if (!seasonsMissingLogged) console.warn("[geo-ranked] season records are off until migration 0049_geo_seasons_history.sql is applied:", error.message);
    seasonsMissingLogged = true;
    throw new SeasonsUnavailable(error.message);
  }
  throw new Error(error.message);
}

const pair = <T>(v: unknown, map: (x: unknown) => T): [T, T] => {
  const a = v as unknown[];
  return [map(a[0]), map(a[1])];
};
const num = (x: unknown) => Number(x);

export function supabaseGeoRankedStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): GeoRankedStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    if (Date.now() < missingUntil) throw new RankedUnavailable("migration 0043 not applied");
    const { data, error } = await sb.rpc(`geo_ranked_${name}`, args);
    check(error);
    return data as unknown;
  };
  const standingOf = async (key: string, today: string, write: boolean) => {
    const r = (await call("standing", { p_key: key, p_today: today, p_write: write })) as Record<string, unknown> | null;
    return r && r.elo !== null && r.elo !== undefined ? r : null;
  };
  return {
    async rating(key, today) {
      const r = await standingOf(key, today, false);
      return r ? { elo: num(r.elo), games: num(r.games) } : null;
    },
    async standing(key, today) {
      const r = await standingOf(key, today, true);
      if (!r) return null;
      return {
        elo: num(r.elo),
        games: num(r.games),
        wins: num(r.wins),
        losses: num(r.losses),
        draws: num(r.draws),
        bestScore: num(r.best_score),
        position: r.position === null || r.position === undefined ? null : num(r.position),
        players: num(r.players),
      };
    },
    async top(limit, today) {
      const rows = ((await call("top", { p_limit: Math.min(limit, LADDER_MAX), p_today: today })) ?? []) as Record<string, unknown>[];
      return rows.map((r, i) => leaderRow(i + 1, { name: String(r.name), elo: num(r.elo), games: num(r.games), wins: num(r.wins), losses: num(r.losses) }));
    },
    async rollSeason(season, today) {
      const { data, error } = await sb.rpc("geo_ranked_season_roll", {
        p_season: season,
        p_starts: geoSeasonStarts(season),
        p_today: today,
        p_keep: GEO_SEASON_KEEP,
        p_floors: GEO_DIVISIONS.map((d) => d.from),
        p_divisions: GEO_DIVISIONS.map((d) => d.id),
      });
      seasonCheck(error);
      return Number(data ?? 0);
    },
    async seasonProgress(key, season) {
      const { data, error } = await sb.rpc("geo_ranked_season_stats", { p_key: key, p_from: season.start, p_to: season.end });
      seasonCheck(error);
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        games: num(r.games ?? 0),
        wins: num(r.wins ?? 0),
        losses: num(r.losses ?? 0),
        draws: num(r.draws ?? 0),
        peakElo: r.peak === null || r.peak === undefined ? null : num(r.peak),
      };
    },
    async seasonHistory(key) {
      const { data, error } = await sb
        .from("geo_ranked_seasons")
        .select("season, games, wins, losses, draws, final_elo, peak_elo, peak_division")
        .eq("player_key", key)
        .order("season", { ascending: false })
        .limit(100);
      seasonCheck(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => {
        const season = num(r.season);
        const id = String(r.peak_division);
        const peakDivision = GEO_DIVISIONS.find((d) => d.id === id)?.id ?? geoDivisionOf(num(r.peak_elo)).id;
        return {
          season,
          name: geoSeasonName(season),
          games: num(r.games),
          wins: num(r.wins),
          losses: num(r.losses),
          draws: num(r.draws),
          finalElo: num(r.final_elo),
          peakElo: num(r.peak_elo),
          peakDivision,
          rewards: geoSeasonRewards(season, peakDivision),
        };
      });
    },
    async apply(input) {
      const r = (await call("apply", {
        p_code: input.code,
        p_today: input.today,
        p_keys: input.keys,
        p_names: input.names,
        p_expect_elo: input.expect.map((e) => e.elo),
        p_expect_games: input.expect.map((e) => e.games),
        p_after: input.after,
        p_scores: input.scores,
        p_points: input.points,
      })) as Record<string, unknown>;
      if (r.status === "stale") {
        const elos = pair(r.elo, num);
        const games = pair(r.games, num);
        return { status: "stale", current: [{ elo: elos[0], games: games[0] }, { elo: elos[1], games: games[1] }] };
      }
      const [a, b] = pair(r.keys, (k) => (k === null || k === undefined ? null : String(k)));
      return { status: r.status === "applied" ? "applied" : "done", keys: [String(a), b], before: pair(r.before, num), after: pair(r.after, num) };
    },
  };
}

/** Where ratings live: memory for tests, local E2E and development without Supabase; else Supabase; null in production without it. */
export function geoRankedStore(): GeoRankedStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryGeoRankedStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseGeoRankedStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryGeoRankedStore() : null;
}

// ---------------------------------------------------------------------------
// Seasons, rolled over lazily
// ---------------------------------------------------------------------------

const rolled = globalThis as unknown as { __pokeiqGeoSeasonRolled?: { season: number; retryAt: number } };
const SEASON_RETRY_MS = 60_000;

/**
 * Brings the ladder into the season running at `now`: the first ranked
 * action after a boundary (a standing read, the ladder, matchmaking or a
 * duel being counted) archives the season just ended and softly resets
 * every rating, in one idempotent database call. Each server instance asks
 * once per season. Never throws: without migration 0049 seasons are only a
 * name and a countdown, and ranked carries on as before.
 */
export async function ensureGeoSeason(store: GeoRankedStore, now = Date.now()): Promise<GeoSeason | null> {
  const season = geoSeasonAt(now);
  if (!season) return null;
  const state = rolled.__pokeiqGeoSeasonRolled;
  if (state && (state.season >= season.number || now < state.retryAt)) return season;
  try {
    await store.rollSeason(season.number, utcDay(now));
    rolled.__pokeiqGeoSeasonRolled = { season: season.number, retryAt: 0 };
  } catch (err) {
    if (!(err instanceof SeasonsUnavailable) && !(err instanceof RankedUnavailable)) console.error("[geo-ranked] season roll-over failed:", err);
    rolled.__pokeiqGeoSeasonRolled = { season: state?.season ?? 0, retryAt: now + SEASON_RETRY_MS };
  }
  return season;
}

/** Forgets that this instance has rolled the season over (tests). */
export function clearGeoSeasonRoll() {
  rolled.__pokeiqGeoSeasonRolled = undefined;
}

/** The season running now, and with `key`, that trainer's season so far and their finished seasons (left out while season records are off). Never throws. */
export async function geoSeasonViewOf(store: GeoRankedStore, key: string | null, now = Date.now()): Promise<GeoSeasonView | null> {
  const season = await ensureGeoSeason(store, now);
  if (!season) return null;
  const view: GeoSeasonView = { number: season.number, name: season.name, startsAt: season.startsAt, endsAt: season.endsAt };
  if (!key) return view;
  try {
    const [you, history] = await Promise.all([store.seasonProgress(key, season), store.seasonHistory(key)]);
    return { ...view, you, history };
  } catch (err) {
    if (!(err instanceof SeasonsUnavailable) && !(err instanceof RankedUnavailable)) console.error("[geo-ranked] season read failed:", err);
    return view;
  }
}

/** A trainer's finished seasons (newest first), or [] while season records are off. For profiles. */
export async function geoSeasonHistoryOf(key: string): Promise<GeoSeasonRecord[]> {
  const store = geoRankedStore();
  if (!store) return [];
  try {
    await ensureGeoSeason(store);
    return await store.seasonHistory(key);
  } catch (err) {
    if (!(err instanceof SeasonsUnavailable) && !(err instanceof RankedUnavailable)) console.error("[geo-ranked] season history failed:", err);
    return [];
  }
}

/** Every cosmetic and badge a trainer has unlocked from ranked PokéGuessr seasons (lib/geo-seasons.ts geoSeasonRewards). [] while season records are off. */
export async function geoSeasonUnlocksOf(key: string): Promise<string[]> {
  return geoSeasonUnlocks(await geoSeasonHistoryOf(key));
}

/** The top of the ladder (at most 100), or null while ranked PokéGuessr is off. */
export async function geoRankedTop(today: string, limit = LADDER_MAX): Promise<GeoRankedLeaderRow[] | null> {
  const store = geoRankedStore();
  if (!store) return null;
  try {
    await ensureGeoSeason(store);
    return await store.top(limit, today);
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[geo-ranked] ladder failed:", err);
    return null;
  }
}

/** A trainer's standing, or null while ranked PokéGuessr is off (or before their first game). */
export async function geoRankedStandingOf(key: string, today: string): Promise<GeoRankedStanding | null> {
  const store = geoRankedStore();
  if (!store) return null;
  try {
    await ensureGeoSeason(store);
    return await store.standing(key, today);
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) console.error("[geo-ranked] standing failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Settling a duel
// ---------------------------------------------------------------------------

/** What a finished ranked duel needs to be counted. */
export interface GeoRankedMatch {
  code: string;
  /** Seat 1 is null for the Gym Leader bot. */
  keys: [string, string | null];
  names: [string, string];
  /** The winner's seat, or null for a draw. */
  winner: number | null;
  /** When the duel ended (the day it counts on). */
  at: number;
  /** Each seat's points over the rounds. */
  points: [number, number];
  /** The bot's Elo (the trainer's division floor) when seat 1 is the bot. */
  botElo?: number;
}

const MAX_TRIES = 5;

/**
 * Counts a finished ranked duel, once: each seat's Elo before and after (by
 * seat). Safe to call again and again for the same duel: later calls return
 * what the first one recorded.
 */
export async function settleGeoRanked(match: GeoRankedMatch, store: GeoRankedStore, config: GeoRatingRules = geoRankedConfig()): Promise<{ before: [number, number]; after: [number, number] }> {
  const scores = geoMatchScores(match.winner);
  const today = new Date(match.at).toISOString().slice(0, 10);
  // A duel that ends after a season boundary is counted from the reset ratings.
  await ensureGeoSeason(store);
  const bot = match.keys[1] === null;
  const fresh = async (key: string): Promise<GeoRatingState> => (await store.rating(key, today)) ?? { elo: GEO_ELO_START, games: 0 };
  let current: [GeoRatingState, GeoRatingState] = [await fresh(match.keys[0]), bot ? { elo: match.botElo ?? GEO_ELO_START, games: 0 } : await fresh(match.keys[1]!)];
  const rules: GeoRatingRules = bot ? { shockDiff: config.shockDiff, kScale: GEO_RANKED_BOT_K_SCALE } : { shockDiff: config.shockDiff };
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const [a, b] = geoRateDuel([current[0].elo, current[1].elo], scores, rules);
    // The bot's Elo never moves.
    const after: [number, number] = [a.after, bot ? current[1].elo : b.after];
    const out = await store.apply({ code: match.code, today, keys: match.keys, names: match.names, expect: current, after, scores, points: match.points });
    if (out.status === "stale") {
      current = out.current;
      continue;
    }
    // Stored in the order of the first write's keys: put them back in this duel's seat order.
    const flip = out.keys[0] !== match.keys[0];
    return flip ? { before: [out.before[1], out.before[0]], after: [out.after[1], out.after[0]] } : { before: out.before, after: out.after };
  }
  throw new Error("Ratings are busy. Try again.");
}
