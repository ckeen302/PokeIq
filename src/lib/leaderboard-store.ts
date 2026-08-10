/**
 * Leaderboard persistence: Supabase when configured, otherwise an in-process
 * fallback so the app remains fully playable with zero configuration.
 */
import { getSupabase, supabaseConfigured } from "./supabase";
import type { LeaderboardCategory } from "@/engines/types";

export interface LeaderboardEntry {
  name: string;
  category: LeaderboardCategory;
  score: number;
  streak: number;
  difficulty: string;
  created_at: string;
}

const TOP_N = 10;

// In-memory fallback (per server process; resets on redeploy). Anchored on
// globalThis so API-route and page bundles share one store — module-level
// state is duplicated per bundle in production builds.
const globalStore = globalThis as unknown as {
  __pokeiqLeaderboard?: LeaderboardEntry[];
};
const memoryStore: LeaderboardEntry[] = (globalStore.__pokeiqLeaderboard ??=
  []);
const MEMORY_CAP = 500;

export async function getTopScores(
  category: LeaderboardCategory,
): Promise<{ entries: LeaderboardEntry[]; persistent: boolean }> {
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from("leaderboard")
      .select("name, category, score, streak, difficulty, created_at")
      .eq("category", category)
      .order("score", { ascending: false })
      .limit(TOP_N);
    if (!error && data) {
      return { entries: data as LeaderboardEntry[], persistent: true };
    }
    console.error("[leaderboard] supabase read failed:", error?.message);
  }
  const entries = memoryStore
    .filter((e) => e.category === category)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
  return { entries, persistent: false };
}

export async function submitScore(
  entry: Omit<LeaderboardEntry, "created_at">,
): Promise<{ ok: boolean; persistent: boolean }> {
  const record: LeaderboardEntry = {
    ...entry,
    created_at: new Date().toISOString(),
  };
  const supabase = getSupabase();
  if (supabase) {
    const { error } = await supabase.from("leaderboard").insert({
      name: record.name,
      category: record.category,
      score: record.score,
      streak: record.streak,
      difficulty: record.difficulty,
    });
    if (!error) return { ok: true, persistent: true };
    console.error("[leaderboard] supabase write failed:", error.message);
  }
  memoryStore.push(record);
  if (memoryStore.length > MEMORY_CAP) memoryStore.splice(0, MEMORY_CAP / 2);
  return { ok: true, persistent: supabaseConfigured() };
}
