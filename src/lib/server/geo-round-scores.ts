import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { GEO_MAX_ROUND_SCORE } from "@/lib/geo-types";
import { geoFamily, isGeoFamily } from "@/lib/geo-families";
import { GEO_STREAK_REGIONS } from "@/lib/geo-streak-types";
import { deriveSeed } from "./crypto";
import { setShotScores } from "./geo";

/**
 * Players' round scores per screenshot (migration 0038, `geo_round_scores`),
 * so each shot's difficulty follows how players really do on it. Since
 * migration 0046 a row also carries who played it (signed-in trainers, as a
 * key), where and in what, so a profile can show accuracy by region and game.
 *
 * Everything here fails open: until the table exists (or without Supabase)
 * nothing is logged and the audit's heuristic ratings stand, so the game
 * plays as before. With POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run),
 * and in development without Supabase, rounds live in memory.
 */

/** The legacy `mode` column: which pool a pin round was graded in. Region streak rounds carry "region-streak" (migration 0046). */
export type RoundMode = "solo" | "daily" | "challenge" | "region-streak";
/** What was being played (migration 0046's `kind` column): finer than `mode`. */
export type RoundKind = "game" | "daily" | "challenge" | "streak" | "region-streak" | "duel";
export interface ShotScoreStat {
  id: string;
  avg: number;
  rounds: number;
}
/** A graded round as logged. Everything past `mode` is for signed-in trainers' stats (profile pages) and needs migration 0046. */
export interface RoundLog {
  shot: string;
  score: number;
  mode: RoundMode;
  /** The trainer's stats key (geoStatsKey), when signed in. */
  player?: string;
  /** The place's region (DLC areas count as their region). */
  region?: string;
  /** The screenshot's game family. */
  family?: string;
  kind?: RoundKind;
  /** The game the round was part of, so games can be counted. */
  run?: string;
  /** Streaks: the place (or region) was named right. */
  hit?: boolean;
}
export interface PlayerRoundRow {
  region: string | null;
  family: string | null;
  kind: RoundKind | null;
  score: number;
  hit: boolean | null;
  run: string | null;
}
export interface RoundScoreStore {
  insert(row: RoundLog): Promise<void>;
  stats(): Promise<ShotScoreStat[]>;
  /** A trainer's logged rounds, newest first (at most `limit`). */
  ofPlayer(key: string, limit?: number): Promise<PlayerRoundRow[]>;
}

class Unavailable extends Error {}

/** The key a trainer's rounds are logged under: an HMAC of their identity, never the id itself. */
export const geoStatsKey = (identity: string) => deriveSeed("geo-stats", identity);

/** Pin rounds only feed the per-shot difficulty: a region streak's right/wrong says nothing about how hard a pin is. */
const ratesShot = (row: Pick<RoundLog, "mode">) => row.mode !== "region-streak";
/** How many of a trainer's latest rounds their stats are read from. */
const PLAYER_ROWS = 4000;

const globalStore = globalThis as unknown as { __pokeiqRoundScores?: RoundLog[] };
const mem = () => (globalStore.__pokeiqRoundScores ??= []);
export function clearMemoryRoundScores() {
  globalStore.__pokeiqRoundScores = [];
  statsUntil = 0;
}

export function memoryRoundScoreStore(): RoundScoreStore {
  return {
    async insert(row) {
      mem().push({ ...row });
    },
    async stats() {
      const by = new Map<string, { sum: number; n: number }>();
      for (const r of mem()) {
        if (!ratesShot(r)) continue;
        const s = by.get(r.shot) ?? { sum: 0, n: 0 };
        s.sum += r.score;
        s.n++;
        by.set(r.shot, s);
      }
      return [...by].map(([id, s]) => ({ id, avg: s.sum / s.n, rounds: s.n }));
    },
    async ofPlayer(key, limit = PLAYER_ROWS) {
      return mem()
        .filter((r) => r.player === key)
        .reverse()
        .slice(0, limit)
        .map((r) => ({ region: r.region ?? null, family: r.family ?? null, kind: r.kind ?? null, score: r.score, hit: r.hit ?? null, run: r.run ?? null }));
    },
  };
}

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
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

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;
/** Migration 0046's columns were missing at this time: until then only the legacy row is written (checked again after a while). */
let narrowUntil = 0;
const NARROW_MS = 10 * 60_000;
export function supabaseRoundScoreStore(sb: Sb): RoundScoreStore {
  return {
    async insert(row) {
      const legacy = { shot_id: row.shot, score: row.score, mode: row.mode };
      const wide = { ...legacy, player_key: row.player ?? null, region: row.region ?? null, family: row.family ?? null, kind: row.kind ?? null, run_id: row.run ?? null, hit: row.hit ?? null };
      const extra = row.player !== undefined || row.region !== undefined || row.kind !== undefined;
      if (extra && Date.now() >= narrowUntil) {
        const { error } = await sb.from("geo_round_scores").insert(wide);
        if (!error) return;
        // Before 0046: the new columns (or the new mode) aren't there yet. Log the legacy row where it's still valid.
        if (!(error.code === "PGRST204" || error.code === "42703" || error.code === "23514" || /column/i.test(error.message ?? ""))) check(error);
        narrowUntil = Date.now() + NARROW_MS;
      }
      if (!ratesShot(row)) throw new Unavailable("region streak rounds need migration 0046_geo_streak.sql");
      const { error } = await sb.from("geo_round_scores").insert(legacy);
      check(error);
    },
    async stats() {
      const { data, error } = await sb.from("geo_shot_score_stats").select("shot_id, rounds, avg_score").limit(50_000);
      check(error);
      return ((data ?? []) as { shot_id: string; rounds: number; avg_score: number }[]).map((r) => ({ id: r.shot_id, avg: Number(r.avg_score), rounds: Number(r.rounds) }));
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
export async function logRoundScore(row: RoundLog, store = roundScoreStore()): Promise<void> {
  if (!store) return;
  try {
    await store.insert(row);
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[geo-round-scores] not logged:", err);
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
