import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { publicName } from "@/lib/name-filter";

export interface GeoBoardRow {
  id: string;
  player_name: string;
  mode: string;
  daily_date: string | null;
  score: number;
  duration_ms: number;
  created_at: string;
}

/**
 * Top PokéGuessr games for a daily date or a free-play mode; null without
 * Supabase. With local accounts (development and the browser tests) a board
 * is empty rather than missing, so its page shows as it does before anyone
 * has played.
 */
export async function fetchGeoBoard(filter: { daily: string } | { mode: string }, limit = 25): Promise<GeoBoardRow[] | null> {
  const rows = await fetchGeoBoardOrUnavailable(filter, limit);
  return rows === "unavailable" ? [] : rows;
}

/** As fetchGeoBoard, but a failed read is "unavailable" rather than an empty board. */
export async function fetchGeoBoardOrUnavailable(filter: { daily: string } | { mode: string }, limit = 25): Promise<GeoBoardRow[] | null | "unavailable"> {
  const supabase = getServiceSupabase();
  if (!supabase) return process.env.POKEIQ_LOCAL_ACCOUNTS === "1" ? [] : null;
  let query = supabase
    .from("geo_runs")
    .select("id, player_name, mode, daily_date, score, duration_ms, created_at")
    .order("score", { ascending: false })
    .order("duration_ms", { ascending: true })
    .limit(limit);
  query = "daily" in filter ? query.eq("daily_date", filter.daily) : query.eq("mode", filter.mode).is("daily_date", null);
  const { data, error } = await query;
  if (error) {
    console.error("[geo-leaderboard] read failed:", error.message);
    return "unavailable";
  }
  // Names stored before they were checked show as "Trainer".
  return (data as GeoBoardRow[]).map((row) => ({ ...row, player_name: publicName(row.player_name) }));
}
