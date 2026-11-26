import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { publicName } from "@/lib/name-filter";
import type { HuntBoardRow } from "@/lib/hunt/types";

/**
 * The Daily Hunt's leaderboard: one table, `hunt_daily_scores` (supabase/migrations/0057_hunt_daily.sql),
 * written only by the server from a signed result (src/app/api/geo/hunt/leaderboard).
 *
 * It degrades to "unavailable" whenever it can't be read or written: no Supabase, or the migration not
 * applied yet (the table is missing). The page then hides the board and the save form entirely. With
 * local accounts (development and the browser tests) and no Supabase it lives in memory, so the board
 * can be seen and tested.
 */

export type HuntBoardRead = { rows: HuntBoardRow[] } | "unavailable";
export type HuntBoardWrite = "saved" | "duplicate" | "unavailable" | "failed";

export interface HuntBoardEntry {
  date: string;
  sid: string;
  name: string;
  score: number;
  rounds: number[];
  durationMs: number;
}

const TABLE = "hunt_daily_scores";
/** Postgres's "undefined table" and PostgREST's "not in the schema cache": the migration isn't applied yet. */
const MISSING = new Set(["42P01", "PGRST205", "PGRST202"]);

const memory: HuntBoardEntry[] = [];
const local = () => process.env.POKEIQ_LOCAL_ACCOUNTS === "1";

const ranked = (rows: { name: string; score: number; durationMs: number }[]): HuntBoardRow[] =>
  rows.map((r, i) => ({ rank: i + 1, name: publicName(r.name), score: r.score, durationMs: r.durationMs }));

/** Today's (or a date's) top games, best first, the faster first on a tie. */
export async function readHuntBoard(date: string, limit = 10): Promise<HuntBoardRead> {
  const supabase = getServiceSupabase();
  if (!supabase) {
    if (!local()) return "unavailable";
    const rows = memory.filter((r) => r.date === date).sort((a, b) => b.score - a.score || a.durationMs - b.durationMs).slice(0, limit);
    return { rows: ranked(rows) };
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select("player_name, score, duration_ms")
    .eq("daily_date", date)
    .order("score", { ascending: false })
    .order("duration_ms", { ascending: true })
    .limit(limit);
  if (error) {
    if (!MISSING.has(error.code ?? "")) console.error("[hunt-board] read failed:", error.message);
    return "unavailable";
  }
  return { rows: ranked((data as { player_name: string; score: number; duration_ms: number }[]).map((r) => ({ name: r.player_name, score: r.score, durationMs: r.duration_ms }))) };
}

/** Puts a game on the board: once per game, once per name a day. */
export async function saveHuntBoard(entry: HuntBoardEntry): Promise<HuntBoardWrite> {
  const supabase = getServiceSupabase();
  if (!supabase) {
    if (!local()) return "unavailable";
    if (memory.some((r) => r.date === entry.date && (r.sid === entry.sid || r.name.toLowerCase() === entry.name.toLowerCase()))) return "duplicate";
    memory.push(entry);
    return "saved";
  }
  const { error } = await supabase.from(TABLE).insert({
    daily_date: entry.date,
    session_id: entry.sid,
    player_name: entry.name,
    score: entry.score,
    rounds: entry.rounds,
    duration_ms: entry.durationMs,
  });
  if (!error) return "saved";
  if (error.code === "23505") return "duplicate";
  if (MISSING.has(error.code ?? "")) return "unavailable";
  console.error("[hunt-board] insert failed:", error.message);
  return "failed";
}

/** Tests: forget the in-memory board. */
export const clearMemoryHuntBoard = () => void memory.splice(0);
