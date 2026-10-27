import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { neaPlayerKey, neaStore } from "@/lib/server/name-em-all-board";
import { scopeCategory } from "@/lib/server/name-em-all-scope";
import type { NeaBoard, NeaBoardResponse } from "@/lib/name-em-all/types";

/**
 * GET /api/name-em-all/leaderboard?scope=gen-1&board=clear|count[&player=<browser id>]
 *
 * The top 50. `rows` is null when the boards are off. With `player`, that
 * browser's own line is marked (and added below the top 50 if it's lower).
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(`nea-board:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const p = request.nextUrl.searchParams;
  const scope = scopeCategory(p.get("scope"));
  const board = p.get("board") as NeaBoard;
  if (!scope || (board !== "clear" && board !== "count")) return NextResponse.json({ error: "No such board." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const player = p.get("player");
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  const mine = user ? neaPlayerKey(`u:${user.id}`) : player && /^[A-Za-z0-9_-]{16,64}$/.test(player) ? neaPlayerKey(`d:${player}`) : null;
  try {
    const all = (await neaStore()?.board(scope.scope, board)) ?? null;
    let rows: NeaBoardResponse["rows"] = null;
    if (all) {
      rows = all.slice(0, 50).map((r) => ({ name: r.name, named: r.named, total: r.total, ms: r.ms, ...(mine && r.player === mine && { you: true }) }));
      const at = mine ? all.findIndex((r) => r.player === mine) : -1;
      if (at >= 50) rows.push({ name: all[at].name, named: all[at].named, total: all[at].total, ms: all[at].ms, you: true });
    }
    const headers = mine ? { "Cache-Control": "private, no-store" } : { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" };
    return NextResponse.json({ scope: scope.scope, board, rows } satisfies NeaBoardResponse, { headers });
  } catch (err) {
    console.error("[name-em-all] leaderboard failed:", err);
    return NextResponse.json({ error: "Couldn't load the leaderboard." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
