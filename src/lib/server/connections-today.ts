import "server-only";
import { CONN_LAUNCH_DATE, type ConnPuzzleResponse } from "@/lib/connections/types";
import { puzzleView } from "@/lib/server/connections";
import { effectiveDaily } from "@/lib/server/connections-social";

/**
 * The dailies a player anywhere could be on right now, for the page itself
 * (ISR): yesterday, today and tomorrow by UTC, since every local date is
 * within a day of UTC's. Tiles only, never the groups: the same view
 * GET /api/connections sends. These three never change once dealt (a
 * category switched off only affects dailies after tomorrow), so a cached
 * page always agrees with the guess checker.
 */
export async function connDailyViews(now = Date.now()): Promise<Record<string, ConnPuzzleResponse>> {
  const day = 86_400_000;
  const dates = [-1, 0, 1].map((k) => new Date(now + k * day).toISOString().slice(0, 10)).filter((d) => d >= CONN_LAUNCH_DATE);
  const out: Record<string, ConnPuzzleResponse> = {};
  for (const date of dates) {
    try {
      out[date] = puzzleView(await effectiveDaily(date), `daily:${date}`, date);
    } catch (err) {
      // The page still works without it: the board falls back to /api/connections.
      console.error("[connections] couldn't deal", date, err);
    }
  }
  return out;
}
