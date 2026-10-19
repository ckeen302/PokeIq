import "server-only";
import { getServiceSupabase, type LeaderboardRow } from "@/lib/supabase";
import { publicName } from "@/lib/name-filter";
import type { PracticeReason, RunResult } from "@/lib/session-types";

export type BoardFilter =
  | { kind: "daily"; date: string }
  | { kind: "iq" }
  | { kind: "module"; module: string; format?: string; difficulty?: string };

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
    // Like-for-like only: all-generation runs at one difficulty.
    query = query.eq("module", filter.module).is("daily_date", null).is("gens", null);
    if (filter.format) query = query.eq("format", filter.format);
    if (filter.difficulty) query = query.eq("difficulty", filter.difficulty);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[leaderboard] read failed:", error.message);
    return [];
  }
  // Names stored before they were checked show as "Trainer".
  return (data as LeaderboardRow[]).map((row) => ({ ...row, player_name: publicName(row.player_name) }));
}

const PRACTICE_MESSAGES: Record<PracticeReason, string> = {
  challenge: "Challenge replays aren't ranked — start a fresh run to get on the board.",
  "repeat-daily": "Only your first Daily Challenge run of the day can be ranked.",
  filtered: "Leaderboards rank all-generation runs — clear the generation filter to compete.",
};

/** Leaderboard eligibility of a verified result: null when it can be ranked. */
export function practiceMessage(result: Pick<RunResult, "spec" | "practice">): string | null {
  const reason = result.practice ?? result.spec.practice;
  return reason ? (PRACTICE_MESSAGES[reason] ?? "This run isn't ranked.") : null;
}
