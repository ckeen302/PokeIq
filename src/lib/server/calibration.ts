import "server-only";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * Empirical item-difficulty calibration.
 *
 * Every graded answer is logged to `question_attempts` (with the player's
 * running rating at the time). The `item_calibration` view turns those into
 * a calibrated difficulty per item once it has enough attempts. Engines
 * ship heuristic priors; this module swaps in the calibrated value when one
 * exists, so question difficulty sharpens as the player base grows.
 *
 * Reads are served from an in-memory snapshot refreshed in the background,
 * so grading never waits on the database.
 */

const REFRESH_MS = 10 * 60 * 1000;
/** PostgREST caps each response (1,000 rows by default), so read in pages. */
const PAGE_ROWS = 1000;
const MAX_PAGES = 100;
let snapshot = new Map<string, number>();
let loadedAt = 0;
let loading: Promise<void> | null = null;

async function refresh(): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) return;
  const next = new Map<string, number>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_ROWS;
    const { data, error } = await supabase
      .from("item_calibration")
      .select("item_key, calibrated_rating")
      .order("item_key")
      .range(from, from + PAGE_ROWS - 1);
    if (error) {
      console.error("[calibration] refresh failed:", error.message);
      return;
    }
    for (const row of data) next.set(row.item_key as string, Number(row.calibrated_rating));
    if (data.length < PAGE_ROWS) break;
  }
  snapshot = next;
}

export function itemRating(itemKey: string, prior: number): number {
  if (Date.now() - loadedAt > REFRESH_MS && !loading && getServiceSupabase()) {
    loadedAt = Date.now();
    loading = refresh().finally(() => (loading = null));
  }
  return snapshot.get(itemKey) ?? prior;
}

/**
 * Resolves when any in-flight snapshot refresh finishes. Route handlers
 * await this inside `after()` so serverless platforms don't freeze the
 * refresh mid-request.
 */
export function calibrationSettled(): Promise<void> {
  return loading ?? Promise.resolve();
}

/** `playerRating` is the server's estimate from the run so far — never a client-supplied value. */
export async function recordAttempt(itemKey: string, correct: boolean, itemRatingUsed: number, playerRating: number) {
  const supabase = getServiceSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("question_attempts").insert({
    item_key: itemKey,
    correct,
    item_rating: Math.round(itemRatingUsed),
    player_rating: Math.round(playerRating),
  });
  if (error) console.error("[calibration] attempt insert failed:", error.message);
}
