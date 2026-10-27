import { NextRequest, NextResponse } from "next/server";
import { isPlayableConnDate, type ConnBoardResponse } from "@/lib/connections/types";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { connBoardStore } from "@/lib/server/connections-board";
import { friendStore } from "@/lib/server/friends-store";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import type { ConnFriendsBoardResponse } from "@/lib/connections/social";

/**
 * GET /api/connections/leaderboard?date=YYYY-MM-DD[&limit=10]
 *
 * The day's PokéConnections leaderboard (ConnBoardResponse): fewest
 * mistakes, then fastest, solved games only. The same for everyone, so the
 * CDN keeps it for 15 seconds. Every row was recorded from the server's own
 * replay and clock (see connections-board.ts). `rows` is null when the board
 * is off.
 *
 * ?scope=friends: you and your accepted friends on the day's board (a
 * ConnFriendsBoardResponse), for the signed-in trainer only, so it is never
 * cached. Same order: hint-free games first.
 */

export async function GET(request: NextRequest) {
  if (!rateLimit(`conn-board:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const params = request.nextUrl.searchParams;
  const date = params.get("date");
  if (!isPlayableConnDate(date)) return NextResponse.json({ error: "No PokéConnections that day." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  if (params.get("scope") === "friends") return friends(request, date);
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

async function friends(request: NextRequest, date: string) {
  const headers = { "Cache-Control": "private, no-store" };
  let user = null;
  if (sessionTokenHash(request)) user = await userFromRequest(request).catch(() => null);
  if (!user) return NextResponse.json({ date, rows: null, signedIn: false } satisfies ConnFriendsBoardResponse, { headers });
  try {
    const board = connBoardStore();
    const fs = friendStore();
    // The puzzle engine behind these loads only for the friends board, keeping the public board's cold start light.
    const [{ connPlayerKey }, { friendsBoard }] = await Promise.all([import("@/lib/server/connections-results"), import("@/lib/server/connections-social")]);
    const rows = board && fs ? await friendsBoard(date, user, fs, board, connPlayerKey) : null;
    return NextResponse.json({ date, rows, signedIn: true } satisfies ConnFriendsBoardResponse, { headers });
  } catch (err) {
    console.error("[connections] friends board failed:", err);
    return NextResponse.json({ error: "Couldn't load your friends' board." }, { status: 503, headers });
  }
}
