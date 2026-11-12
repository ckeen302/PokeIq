import { LEADERBOARD_BOARDS } from "@/lib/leaderboard-boards";
import { LeaderboardView, leaderboardBoardMetadata } from "../../view";

/**
 * A board's current standings, rebuilt at most every few seconds: the nav
 * links here from every page, and a busy day would otherwise run every
 * board's database reads once per view. People reach it as
 * /leaderboard?board=<id> (rewritten here in next.config.ts); a saved Daily
 * Challenge score clears the Daily board's cache at once (LEADERBOARD_TAG).
 */
export const revalidate = 15;
export const dynamicParams = false;
export const metadata = leaderboardBoardMetadata;

export function generateStaticParams() {
  return LEADERBOARD_BOARDS.map((board) => ({ board }));
}

export default async function LeaderboardBoardPage({ params }: { params: Promise<{ board: string }> }) {
  return LeaderboardView({ params: { board: (await params).board } });
}
