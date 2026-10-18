import "server-only";
import { getServiceSupabase } from "@/lib/supabase";

export interface GeoBoardRow {
  id: string;
  player_name: string;
  mode: string;
  daily_date: string | null;
  score: number;
  duration_ms: number;
  created_at: string;
}

/** Top PokéGuessr games for a daily date or a free-play mode; null without Supabase. */
export async function fetchGeoBoard(filter: { daily: string } | { mode: string }, limit = 25): Promise<GeoBoardRow[] | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;
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
    return [];
  }
  return data as GeoBoardRow[];
}
