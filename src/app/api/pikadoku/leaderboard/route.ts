import { NextRequest, NextResponse } from "next/server";
import { isPlayableConnDate } from "@/lib/connections/types";
import { isLiveWeek } from "@/lib/pikadoku/weeks";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { friendStore } from "@/lib/server/friends-store";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { pdkPlayerKey, pdkStore } from "@/lib/server/pikadoku-board";
import { PDK_DIFFICULTIES, type PdkBoardResponse, type PdkDifficulty, type PdkSlot } from "@/lib/pikadoku/types";

/**
 * GET /api/pikadoku/leaderboard?date=YYYY-MM-DD[&difficulty=normal][&scope=friends]
 * GET /api/pikadoku/leaderboard?week=<Monday>[&scope=friends]      the live weekly grid's board
 *
 * The day's board: most cells solved, then the lowest uniqueness score, then
 * the quicker time. `rows` is null when the board is off. ?scope=friends is
 * you and your accepted friends, for the signed-in trainer only.
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(`pdk-board:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const p = request.nextUrl.searchParams;
  const week = p.get("week");
  const date = week ?? p.get("date");
  const difficulty: PdkSlot = week ? "weekly" : ((p.get("difficulty") ?? "normal") as PdkDifficulty);
  const valid = week ? isLiveWeek(week) : isPlayableConnDate(date) && PDK_DIFFICULTIES.includes(difficulty as PdkDifficulty);
  if (!valid || !date) return NextResponse.json({ error: "No Pikadoku that day." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const friends = p.get("scope") === "friends";
  try {
    let all = (await pdkStore()?.board(date, difficulty)) ?? null;
    let mine = "";
    if (friends) {
      const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
      if (!user) return NextResponse.json({ date, difficulty, rows: null, signedIn: false } satisfies PdkBoardResponse, { headers: { "Cache-Control": "private, no-store" } });
      const fs = friendStore();
      const ids = fs ? (await fs.friendshipsOf(user.id)).filter((f) => f.status === "accepted").map((f) => (f.a === user.id ? f.b : f.a)) : [];
      const keys = new Set([user.id, ...ids].map((id) => pdkPlayerKey(`u:${id}`)));
      mine = pdkPlayerKey(`u:${user.id}`);
      all = all && fs ? all.filter((r) => keys.has(r.player)) : null;
    }
    const rows = all?.slice(0, 50).map((r) => ({ name: r.name, solved: r.solved, score: r.score, ms: r.ms, ...(friends && { you: r.player === mine }) })) ?? null;
    const headers = friends ? { "Cache-Control": "private, no-store" } : { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" };
    return NextResponse.json({ date, difficulty, rows, ...(friends && { signedIn: true }) } satisfies PdkBoardResponse, { headers });
  } catch (err) {
    console.error("[pikadoku] leaderboard failed:", err);
    return NextResponse.json({ error: "Couldn't load the leaderboard." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
