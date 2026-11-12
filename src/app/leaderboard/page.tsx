import { LeaderboardView, leaderboardMetadata, type LeaderboardParams } from "./view";

export const metadata = leaderboardMetadata;
// A board for a given date or format renders per request. A bare board link (/leaderboard,
// /leaderboard?board=geo) is rewritten to its cached page, /leaderboard/board/<id> (next.config.ts).
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<LeaderboardParams> }) {
  return <LeaderboardView params={await searchParams} />;
}
