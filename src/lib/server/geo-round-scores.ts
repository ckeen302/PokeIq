import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import { geoFamily, isGeoFamily } from "@/lib/geo-families";
import { GEO_STREAK_REGIONS } from "@/lib/geo-streak-types";
import { deriveSeed } from "./crypto";
import { setShotScores } from "./geo";

/**
 * Players' round scores per screenshot (migration 0040, `geo_round_scores`),
 * so each shot's difficulty follows how players really do on it, and (with
 * migration 0045) who played each round and how, for the behaviour flags
 * that moderators read on /admin/geo-flags; with migration 0046 also where
 * and in what, so a profile can show accuracy by region and game.
 *
 * Everything here fails open: until the table exists (or without Supabase)
 * nothing is logged and the audit's heuristic ratings stand, so the game
 * plays as before; before 0045 the rows are written without the player and
 * flag columns. With POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run),
 * and in development without Supabase, rounds live in memory.
 */

/** The `mode` column: which pool a round was graded in. */
export type RoundMode = "solo" | "daily" | "challenge" | "duel" | "ranked" | "region-streak";
/** What was being played (migration 0046's `kind` column): finer than `mode`. */
export type RoundKind = "game" | "daily" | "challenge" | "streak" | "region-streak" | "duel";
export interface ShotScoreStat {
  id: string;
  avg: number;
  rounds: number;
}

// ---------------------------------------------------------------------------
// Behaviour flags (how GeoGuessr does it: hidden flags, no automatic bans)
// ---------------------------------------------------------------------------

/**
 * A round's flag level, from how it was played:
 *   2: the pin within a few pixels of the place, under two seconds after the
 *      round was dealt (the picture had to load in that time too): no human does that;
 *   1: a perfect score that fast: possible once by luck, suspicious when it repeats across games;
 *   0: nothing to note.
 * The levels are stored with the round; moderators see the counts per player.
 */
export type RoundFlag = 0 | 1 | 2;
export const GEO_FLAG_PX = 3;
export const GEO_FLAG_MS = 2_000;
export function roundFlag(played: { px: number; elapsedMs: number; perfect: boolean }): RoundFlag {
  if (played.elapsedMs >= GEO_FLAG_MS) return 0;
  if (played.px <= GEO_FLAG_PX) return 2;
  return played.perfect ? 1 : 0;
}

export interface RoundScoreRow {
  shot: string;
  score: number;
  mode: RoundMode;
  /** The trainer (an HMAC of their account or device), and their name when signed in. */
  player?: { key: string; name: string | null } | string | null;
  /** The game the round belongs to (flags that repeat across games weigh more). */
  game?: string;
  elapsedMs?: number;
  flag?: RoundFlag;
  /** Migration 0046: the place's region, the shot's game family, what was played, the run, and (streaks) whether the pick was right. */
  region?: string;
  family?: string;
  kind?: RoundKind;
  run?: string;
  hit?: boolean;
}
/** Back-compat name. */
export type RoundLog = RoundScoreRow;
export interface PlayerRoundRow {
  region: string | null;
  family: string | null;
  kind: RoundKind | null;
  score: number;
  hit: boolean | null;
  run: string | null;
}
const playerKeyOf = (p: RoundScoreRow["player"]) => (typeof p === "string" ? p : p?.key ?? null);
const playerNameOf = (p: RoundScoreRow["player"]) => (typeof p === "string" ? null : p?.name ?? null);

/** The key a trainer's rounds are logged under (an HMAC of `u:<account id>` or `d:<device>`), never the id itself. */
export const geoStatsKey = (identity: string) => deriveSeed("geo-player", identity);
/** Pin rounds only feed the per-shot difficulty: a region pick's right/wrong says nothing about how hard a pin is. */
const ratesShot = (row: Pick<RoundScoreRow, "mode">) => row.mode !== "region-streak";
/** How many of a trainer's latest rounds their stats are read from. */
const PLAYER_ROWS = 4000;

/** One trainer's flagged play, as the moderation desk lists it. */
export interface FlaggedPlayer {
  key: string;
  name: string | null;
  /** Rounds at level 2 (pixel-perfect, under two seconds). */
  flagged: number;
  /** Rounds at level 1 or 2 (a perfect score under two seconds). */
  fast: number;
  /** Games with a flagged round, and rounds played in all. */
  games: number;
  rounds: number;
  lastAt: number;
}

export interface RoundScoreStore {
  insert(row: RoundScoreRow): Promise<void>;
  stats(): Promise<ShotScoreStat[]>;
  /** Trainers with flagged rounds, most flagged first. */
  flagged(): Promise<FlaggedPlayer[]>;
  /** A trainer's logged rounds, newest first (at most `limit`). */
  ofPlayer(key: string, limit?: number): Promise<PlayerRoundRow[]>;
}

export class RoundScoresUnavailable extends Error {}
class Unavailable extends RoundScoresUnavailable {}

interface MemoryRow extends RoundScoreRow {
  at: number;
}
const globalStore = globalThis as unknown as { __pokeiqRoundScores?: MemoryRow[] };
const mem = () => (globalStore.__pokeiqRoundScores ??= []);
export function clearMemoryRoundScores() {
  globalStore.__pokeiqRoundScores = [];
  statsUntil = 0;
}

/** Trainers with flagged rounds from a list of rounds (the memory store; the database view does the same). */
export function flaggedFrom(rows: Iterable<MemoryRow>): FlaggedPlayer[] {
  const by = new Map<string, FlaggedPlayer & { gameIds: Set<string> }>();
  for (const r of rows) {
    const key = playerKeyOf(r.player);
    if (!key) continue;
    const p = by.get(key) ?? { key, name: null, flagged: 0, fast: 0, games: 0, rounds: 0, lastAt: 0, gameIds: new Set<string>() };
    p.rounds++;
    const name = playerNameOf(r.player);
    if (name) p.name = name;
    if ((r.flag ?? 0) >= 1) {
      p.fast++;
      p.lastAt = Math.max(p.lastAt, r.at);
      if (r.game) p.gameIds.add(r.game);
    }
    if ((r.flag ?? 0) >= 2) p.flagged++;
    by.set(key, p);
  }
  return [...by.values()]
    .filter((p) => p.fast > 0)
    .map(({ gameIds, ...p }) => ({ ...p, games: gameIds.size }))
    .sort((a, b) => b.flagged - a.flagged || b.fast - a.fast || b.lastAt - a.lastAt);
}

export function memoryRoundScoreStore(): RoundScoreStore {
  return {
    async insert(row) {
      mem().push({ ...row, at: Date.now() });
    },
    async stats() {
      const by = new Map<string, { sum: number; n: number }>();
      for (const r of mem().filter(ratesShot)) {
        const s = by.get(r.shot) ?? { sum: 0, n: 0 };
        s.sum += r.score;
        s.n++;
        by.set(r.shot, s);
      }
      return [...by].map(([id, s]) => ({ id, avg: s.sum / s.n, rounds: s.n }));
    },
    async flagged() {
      return flaggedFrom(mem());
    },
    async ofPlayer(key, limit = PLAYER_ROWS) {
      return mem()
        .filter((r) => playerKeyOf(r.player) === key)
        .reverse()
        .slice(0, limit)
        .map((r) => ({ region: r.region ?? null, family: r.family ?? null, kind: r.kind ?? null, score: r.score, hit: r.hit ?? null, run: r.run ?? null }));
    },
  };
}

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
/** The 0045 columns aren't there (PGRST204: a column the schema cache doesn't know; 42703: undefined column). */
const NO_COLUMN = new Set(["PGRST204", "42703"]);
let warnedAt = 0;
function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (MISSING.has(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "")) {
    if (Date.now() - warnedAt > 10 * 60_000) console.warn("[geo-round-scores] off until migration 0040_geo_round_scores.sql is applied:", error.message);
    warnedAt = Date.now();
    throw new Unavailable(error.message);
  }
  throw new Error(error.message);
}

/** After the flag columns are found missing, rows go without them for this long (so applying 0045 needs no redeploy). */
const RECHECK_MS = 10 * 60_000;
let plainUntil = 0;

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;
export function supabaseRoundScoreStore(sb: Sb): RoundScoreStore {
  return {
    async insert(row) {
      const base = { shot_id: row.shot, score: row.score, mode: row.mode };
      if (Date.now() >= plainUntil) {
        const full = {
          ...base,
          player_key: playerKeyOf(row.player),
          player_name: playerNameOf(row.player),
          game_id: row.game ?? null,
          elapsed_ms: row.elapsedMs === undefined ? null : Math.min(Math.round(row.elapsedMs), 86_400_000),
          flag: row.flag ?? 0,
          region: row.region ?? null,
          family: row.family ?? null,
          kind: row.kind ?? null,
          run_id: row.run ?? null,
          hit: row.hit ?? null,
        };
        const { error } = await sb.from("geo_round_scores").insert(full);
        if (!error) return;
        // 23514: a mode the check constraint doesn't know yet (region-streak before 0046).
        if (!NO_COLUMN.has(error.code ?? "") && error.code !== "23514") check(error);
        // Before migrations 0045/0046: the row without the newer columns.
        if (Date.now() >= plainUntil) console.warn("[geo-round-scores] newer columns need migrations 0045_geo_flags.sql and 0046_geo_streak.sql:", error.message);
        plainUntil = Date.now() + RECHECK_MS;
      }
      if (!ratesShot(row)) throw new Unavailable("region streak rounds need migration 0046_geo_streak.sql");
      const { error } = await sb.from("geo_round_scores").insert(base);
      check(error);
    },
    async stats() {
      const { data, error } = await sb.from("geo_shot_score_stats").select("shot_id, rounds, avg_score").limit(50_000);
      check(error);
      return ((data ?? []) as { shot_id: string; rounds: number; avg_score: number }[]).map((r) => ({ id: r.shot_id, avg: Number(r.avg_score), rounds: Number(r.rounds) }));
    },
    async flagged() {
      const { data, error } = await sb.from("geo_flagged_players").select("player_key, player_name, flagged, fast, games, rounds, last_at").order("flagged", { ascending: false }).order("fast", { ascending: false }).limit(500);
      check(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        key: String(r.player_key),
        name: r.player_name ? String(r.player_name) : null,
        flagged: Number(r.flagged),
        fast: Number(r.fast),
        games: Number(r.games),
        rounds: Number(r.rounds),
        lastAt: r.last_at ? Date.parse(String(r.last_at)) : 0,
      }));
    },
    async ofPlayer(key, limit = PLAYER_ROWS) {
      const { data, error } = await sb.from("geo_round_scores").select("region, family, kind, score, hit, run_id").eq("player_key", key).order("created_at", { ascending: false }).limit(limit);
      check(error);
      return ((data ?? []) as { region: string | null; family: string | null; kind: RoundKind | null; score: number; hit: boolean | null; run_id: string | null }[]).map((r) => ({
        region: r.region,
        family: r.family,
        kind: r.kind,
        score: Number(r.score),
        hit: r.hit,
        run: r.run_id,
      }));
    },
  };
}

export function roundScoreStore(): RoundScoreStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryRoundScoreStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseRoundScoreStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryRoundScoreStore() : null;
}

/** Logs a graded round. Never throws: a database problem can't stop a game. */
export async function logRoundScore(row: RoundScoreRow, store = roundScoreStore()): Promise<void> {
  if (!store) return;
  try {
    await store.insert(row);
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[geo-round-scores] not logged:", err);
  }
}

/** The moderation desk's list: null when rounds aren't stored here, or before migration 0045. */
export async function flaggedPlayers(store = roundScoreStore()): Promise<FlaggedPlayer[] | null> {
  if (!store) return null;
  try {
    return await store.flagged();
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[geo-round-scores] flags not read:", err);
    return null;
  }
}

/** How long the per-shot averages are trusted before they're read again. */
const STATS_TTL_MS = 10 * 60_000;
let statsUntil = 0;
let loading: Promise<void> | null = null;

/** Brings the shots' player-based difficulty up to date (at most every ten minutes); never throws or waits long. */
export async function syncShotScores(now = Date.now(), store = roundScoreStore()): Promise<void> {
  if (!store || now < statsUntil) return;
  loading ??= (async () => {
    try {
      setShotScores(await store.stats());
    } catch (err) {
      if (!(err instanceof Unavailable)) console.error("[geo-round-scores] averages not read:", err);
    } finally {
      statsUntil = Date.now() + STATS_TTL_MS;
      loading = null;
    }
  })();
  await Promise.race([loading, new Promise((r) => setTimeout(r, 1_500))]);
}

// ---------------------------------------------------------------------------
// A trainer's PokéGuessr stats (profile pages)
// ---------------------------------------------------------------------------

export interface GeoStatRow {
  /** A region's name, or a game family's. */
  key: string;
  /** Pin rounds (games, dailies, challenges, pin streaks, duels). */
  rounds: number;
  /** Mean round score as a share of 5,000, in percent. */
  accuracy: number;
  /** The best single round. */
  best: number;
  /** Region streak picks here, and how many were right. */
  streakPicks: number;
  streakHits: number;
}
export interface GeoPlayerStats {
  /** Pin rounds logged. */
  rounds: number;
  /** Games (runs) those rounds came from. */
  games: number;
  /** Region streak picks and how many were right. */
  streakPicks: number;
  streakHits: number;
  byRegion: GeoStatRow[];
  byGame: GeoStatRow[];
}

const REGION_ORDER: readonly string[] = GEO_STREAK_REGIONS;

/** Accuracy and best score by region and by game, and the games played, from a trainer's logged rounds. */
export function aggregateGeoStats(rows: readonly PlayerRoundRow[]): GeoPlayerStats {
  const byRegion = new Map<string, GeoStatRow>();
  const byGame = new Map<string, GeoStatRow>();
  const sums = new Map<GeoStatRow, number>();
  const runs = new Set<string>();
  let rounds = 0;
  let streakPicks = 0;
  let streakHits = 0;
  const row = (map: Map<string, GeoStatRow>, key: string) => {
    let r = map.get(key);
    if (!r) {
      r = { key, rounds: 0, accuracy: 0, best: 0, streakPicks: 0, streakHits: 0 };
      map.set(key, r);
    }
    return r;
  };
  const add = (r: GeoStatRow, x: PlayerRoundRow) => {
    if (x.kind === "region-streak") {
      r.streakPicks++;
      if (x.hit) r.streakHits++;
      return;
    }
    r.rounds++;
    r.best = Math.max(r.best, x.score);
    sums.set(r, (sums.get(r) ?? 0) + x.score);
  };
  for (const x of rows) {
    if (x.kind === "region-streak") {
      streakPicks++;
      if (x.hit) streakHits++;
    } else {
      rounds++;
      if (x.run) runs.add(x.run);
    }
    if (x.region) add(row(byRegion, x.region), x);
    if (x.family && isGeoFamily(x.family)) add(row(byGame, geoFamily(x.family).name), x);
  }
  const finish = (map: Map<string, GeoStatRow>, order: (a: GeoStatRow, b: GeoStatRow) => number) =>
    [...map.values()]
      .map((r) => ({ ...r, accuracy: r.rounds ? Math.round(((sums.get(r) ?? 0) / r.rounds / GEO_MAX_ROUND_SCORE) * 100) : 0 }))
      .sort(order);
  return {
    rounds,
    games: runs.size,
    streakPicks,
    streakHits,
    byRegion: finish(byRegion, (a, b) => REGION_ORDER.indexOf(a.key) - REGION_ORDER.indexOf(b.key) || a.key.localeCompare(b.key)),
    byGame: finish(byGame, (a, b) => b.rounds + b.streakPicks - (a.rounds + a.streakPicks)),
  };
}

/** A trainer's stats, or null without a store or before migration 0046. Never throws. */
export async function playerGeoStats(key: string, store = roundScoreStore()): Promise<GeoPlayerStats | null> {
  if (!store) return null;
  try {
    return aggregateGeoStats(await store.ofPlayer(key));
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[geo-round-scores] stats not read:", err);
    return null;
  }
}
