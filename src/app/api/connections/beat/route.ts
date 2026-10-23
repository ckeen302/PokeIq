import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { beatPath } from "@/lib/connections/social";
import { isCurrentConnDate } from "@/lib/connections/types";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, PLAYER, whoIs } from "@/lib/server/connections-custom-http";
import { connPlayerKey } from "@/lib/server/connections-results";
import { connBoardStore } from "@/lib/server/connections-board";
import { beatToken, readBeatToken } from "@/lib/server/connections-social";

/**
 * "Beat my time" links.
 *
 * POST /api/connections/beat { date, player }
 *   A link to today's daily carrying your own ranked result, read from the
 *   leaderboard (never from numbers you send) and signed by the server.
 *   { path } is /connections?beat=<token>; 404 when you aren't on the board.
 * GET /api/connections/beat?token=...
 *   What a link's token says ({ date, name, mistakes, ms, hinted }), or 404
 *   if the server didn't sign it. The friend then plays the normal daily.
 */

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-beat-make:${clientIp(request)}`, 10, 0.2)) return tooManyRequests();
  const parsed = z.object({ date: z.string().max(10), player: PLAYER.optional() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !isCurrentConnDate(parsed.data.date)) return NextResponse.json({ error: "Only today's PokéConnections can be shared." }, { status: 400, headers: NO_STORE });
  const who = await whoIs(request, parsed.data.player);
  if (!who) return NextResponse.json({ error: "Missing player id." }, { status: 400, headers: NO_STORE });
  const board = connBoardStore();
  const token = board ? await beatToken(parsed.data.date, connPlayerKey(who.identity), board) : null;
  if (!token) return NextResponse.json({ error: "Get on today's leaderboard first." }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ path: beatPath(token) }, { headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  if (!rateLimit(`conn-beat-read:${clientIp(request)}`, 30, 1)) return tooManyRequests();
  const challenge = readBeatToken(request.nextUrl.searchParams.get("token"));
  if (!challenge) return NextResponse.json({ error: "That link isn't valid." }, { status: 404, headers: NO_STORE });
  return NextResponse.json(challenge, { headers: NO_STORE });
}
