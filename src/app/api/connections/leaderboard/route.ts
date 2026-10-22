import { NextRequest, NextResponse } from "next/server";
import { isPlayableConnDate, type ConnBoardResponse } from "@/lib/connections/types";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { connBoardStore } from "@/lib/server/connections-board";

/**
 * GET /api/connections/leaderboard?date=YYYY-MM-DD[&limit=10]
 *
 * The day's PokéConnections leaderboard (ConnBoardResponse): fewest
 * mistakes, then fastest, solved games only. The same for everyone, so the
 * CDN keeps it for 15 seconds. Every row was recorded from the server's own
 * replay and clock (see connections-board.ts). `rows` is null when the board
 * is off.
 */

export async function GET(request: NextRequest) {
  if (!rateLimit(`conn-board:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const params = request.nextUrl.searchParams;
  const date = params.get("date");
  if (!isPlayableConnDate(date)) return NextResponse.json({ error: "No PokéConnections that day." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 10));
  try {
    const rows = (await connBoardStore()?.top(date, limit)) ?? null;
    const body: ConnBoardResponse = { date, rows };
    return NextResponse.json(body, { headers: { "Cache-Control": rows ? "public, s-maxage=15, stale-while-revalidate=60" : "public, s-maxage=60" } });
  } catch (err) {
    console.error("[connections] leaderboard failed:", err);
    return NextResponse.json({ error: "Couldn't load the leaderboard." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
