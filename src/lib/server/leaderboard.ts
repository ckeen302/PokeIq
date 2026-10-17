import "server-only";
import { getServiceSupabase, type LeaderboardRow } from "@/lib/supabase";

export type BoardFilter =
  | { kind: "daily"; date: string }
  | { kind: "iq" }
  | { kind: "module"; module: string; format?: string };

/** Top runs for a board, or null when persistence isn't configured. */
export async function fetchBoard(filter: BoardFilter, limit = 25): Promise<LeaderboardRow[] | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  let query = supabase
    .from("runs")
    .select("id, player_name, module, format, difficulty, daily_date, score, correct, total, best_streak, pokeiq, duration_ms, created_at")
    // The adaptive test ranks by measured PokéIQ; everything else by score.
    .order(filter.kind === "iq" ? "pokeiq" : "score", { ascending: false })
    .order(filter.kind === "iq" ? "score" : "duration_ms", { ascending: filter.kind !== "iq" })
    .limit(limit);
  if (filter.kind === "iq") {
    query = query.eq("format", "adaptive");
  } else if (filter.kind === "daily") {
    query = query.eq("daily_date", filter.date);
  } else {
    query = query.eq("module", filter.module).is("daily_date", null);
    if (filter.format) query = query.eq("format", filter.format);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[leaderboard] read failed:", error.message);
    return [];
  }
  return data as LeaderboardRow[];
}
