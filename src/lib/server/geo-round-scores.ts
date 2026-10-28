import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { setShotScores } from "./geo";

/**
 * Players' round scores per screenshot (migration 0040, `geo_round_scores`),
 * so each shot's difficulty follows how players really do on it, and (with
 * migration 0045) who played each round and how, for the behaviour flags
 * that moderators read on /admin/geo-flags.
 *
 * Everything here fails open: until the table exists (or without Supabase)
 * nothing is logged and the audit's heuristic ratings stand, so the game
 * plays as before; before 0045 the rows are written without the player and
 * flag columns. With POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run),
 * and in development without Supabase, rounds live in memory.
 */

export type RoundMode = "solo" | "daily" | "challenge" | "duel" | "ranked";
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
  player?: { key: string; name: string | null } | null;
  /** The game the round belongs to (flags that repeat across games weigh more). */
  game?: string;
  elapsedMs?: number;
  flag?: RoundFlag;
}

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
    if (!r.player) continue;
    const p = by.get(r.player.key) ?? { key: r.player.key, name: null, flagged: 0, fast: 0, games: 0, rounds: 0, lastAt: 0, gameIds: new Set<string>() };
    p.rounds++;
    if (r.player.name) p.name = r.player.name;
    if ((r.flag ?? 0) >= 1) {
      p.fast++;
      p.lastAt = Math.max(p.lastAt, r.at);
      if (r.game) p.gameIds.add(r.game);
    }
    if ((r.flag ?? 0) >= 2) p.flagged++;
    by.set(r.player.key, p);
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
      for (const r of mem()) {
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
          player_key: row.player?.key ?? null,
          player_name: row.player?.name ?? null,
          game_id: row.game ?? null,
          elapsed_ms: row.elapsedMs === undefined ? null : Math.min(Math.round(row.elapsedMs), 86_400_000),
          flag: row.flag ?? 0,
        };
        const { error } = await sb.from("geo_round_scores").insert(full);
        if (!error) return;
        if (!NO_COLUMN.has(error.code ?? "")) check(error);
        // Before migration 0045: the row without the player and flag columns.
        if (Date.now() >= plainUntil) console.warn("[geo-round-scores] player and flag columns need migration 0045_geo_flags.sql:", error.message);
        plainUntil = Date.now() + RECHECK_MS;
      }
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
