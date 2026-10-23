import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CONN_GROUP_SIZE, CONN_GROUPS, CONN_MAX_MISTAKES, type ConnResultResponse } from "@/lib/connections/types";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { duelNameSchema } from "@/lib/server/duel-core";
import { recordConnResult } from "@/lib/server/connections-results";

/**
 * POST /api/connections/result { date, player, guesses, start?, name? }
 *
 * Records a finished daily PokéConnections and returns the day's stats
 * (ConnResultResponse: trainers, solves, perfect solves) and where it stands
 * on the daily leaderboard. The server plays `guesses` again, so nothing can
 * be made up: the mistakes come from that replay, and the time from `start`,
 * the token the server signed when it dealt the tiles, to now. The first
 * result per trainer and day is kept; sending it again (a reload, or with a
 * name added) just returns where it stands.
 *
 * `player` is the random id the browser keeps. A signed-in trainer counts as
 * their account, everywhere, and ranks under their username; otherwise
 * `name` (their trainer name) is needed to rank.
 *
 * { available: false } when stats are off: the game works the same without them.
 */

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  date: z.string().max(10),
  player: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Bad player id."),
  guesses: z
    .array(z.array(z.number().int().positive().max(100_000)).length(CONN_GROUP_SIZE))
    .min(1)
    .max(CONN_GROUPS + CONN_MAX_MISTAKES + 4),
  start: z.string().max(400).optional(),
  name: duelNameSchema.optional(),
});

async function account(request: NextRequest) {
  if (!sessionTokenHash(request)) return null;
  try {
    return await userFromRequest(request);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-result:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const { date, player, guesses, start, name } = parsed.data;
  try {
    const user = await account(request);
    const out = await recordConnResult({ date, identity: user ? `u:${user.id}` : `d:${player}`, guesses, start, name: user ? user.username : (name ?? null) });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const extras = { board: out.board, hinted: out.hinted, ...(out.groups && { groups: out.groups }), ...(out.mine && { mine: out.mine }) };
    const body: ConnResultResponse = out.summary ? { available: true, summary: out.summary, ...extras } : { available: false, ...extras };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    // Stats are a bonus: the game goes on without them.
    console.error("[connections] record failed:", err);
    return NextResponse.json({ available: false } satisfies ConnResultResponse, { headers: NO_STORE });
  }
}
