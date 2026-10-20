import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import type { FrontierKey } from "@/lib/battle/frontier";

/**
 * Best Battle Factory / Battle Tower streaks for signed-in trainers
 * (`frontier_streaks`, migration 0016; RLS-locked, service role only).
 * Until that migration is applied, or without Supabase, bests are kept in
 * memory for this server process only; any database error is logged and
 * treated as "no server best", since the browser keeps its own too.
 */

const memory = new Map<string, number>();
const memKey = (userId: string, key: FrontierKey) => `${userId}:${key}`;

/** Keeps `streak` if it beats the trainer's best; returns the best (null if it couldn't be read). */
export async function recordFrontierBest(userId: string, key: FrontierKey, streak: number): Promise<number | null> {
  const sb = getServiceSupabase();
  if (!sb) {
    const best = Math.max(memory.get(memKey(userId, key)) ?? 0, streak);
    memory.set(memKey(userId, key), best);
    return best;
  }
  try {
    const { data, error } = await sb.rpc("frontier_record_best", { p_user: userId, p_facility: key, p_streak: streak });
    if (error) throw new Error(error.message);
    return typeof data === "number" ? data : null;
  } catch (err) {
    console.warn("[frontier] best streak not saved:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** A trainer's bests per facility; empty if there's no table yet. */
export async function frontierBests(userId: string): Promise<Partial<Record<FrontierKey, number>>> {
  const sb = getServiceSupabase();
  if (!sb) {
    const out: Partial<Record<FrontierKey, number>> = {};
    for (const key of ["factory", "bssfactory", "tower"] as const) {
      const best = memory.get(memKey(userId, key));
      if (best !== undefined) out[key] = best;
    }
    return out;
  }
  try {
    const { data, error } = await sb.from("frontier_streaks").select("facility, best").eq("user_id", userId);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data ?? []).map((r: { facility: string; best: number }) => [r.facility, r.best]));
  } catch (err) {
    console.warn("[frontier] bests not read:", err instanceof Error ? err.message : err);
    return {};
  }
}
