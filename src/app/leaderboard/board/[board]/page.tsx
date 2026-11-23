import { LEADERBOARD_BOARDS } from "@/lib/leaderboard-boards";
import { databaseTroubleCount } from "@/lib/supabase";
import { LeaderboardView, leaderboardBoardMetadata } from "../../view";

/**
 * A board's current standings, rebuilt at most once a minute: the nav links
 * here from every page, and a busy day would otherwise run every board's
 * database reads once per view. Each rebuild is also a write to Vercel's ISR
 * cache, whose free allowance is small, so the window is a minute rather than
 * seconds. People reach it as /leaderboard?board=<id> (rewritten here in
 * next.config.ts); a saved Daily Challenge score clears the Daily board's
 * cache sooner, at most every BOARD_REFRESH_MS (refreshBoards).
 */
export const revalidate = 60;
export const dynamicParams = false;
export const generateMetadata = leaderboardBoardMetadata;

export function generateStaticParams() {
  return LEADERBOARD_BOARDS.map((board) => ({ board }));
}

/**
 * When the database fails while the page is being rebuilt, the rebuild throws:
 * Next then keeps serving the last good board instead of caching an
 * "unavailable" one for the next minute. Not at build time, where there is no
 * earlier copy to keep (the page says the board is unavailable instead).
 */
export default async function LeaderboardBoardPage({ params }: { params: Promise<{ board: string }> }) {
  const board = (await params).board;
  const before = databaseTroubleCount();
  const page = await LeaderboardView({ params: { board } });
  if (databaseTroubleCount() > before && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(`leaderboard ${board}: the database failed during the rebuild; keeping the last copy`);
  }
  return page;
}
