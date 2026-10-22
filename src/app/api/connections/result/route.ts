import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CONN_GROUP_SIZE, CONN_GROUPS, CONN_MAX_MISTAKES, type ConnResultResponse } from "@/lib/connections/types";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { recordConnResult } from "@/lib/server/connections-results";

/**
 * POST /api/connections/result { date, player, guesses }
 *
 * Records a finished daily PokéConnections for the day's stats and returns
 * them (ConnResultResponse: trainers, solves, perfect solves). The server
 * plays `guesses` again, so a result can't be made up; the first result
 * per trainer and day is kept, and sending it again (a reload) just returns
 * the totals. `player` is the random id the browser keeps; a signed-in
 * trainer counts as their account instead, on every device.
 *
 * { available: false } when stats are off (no Supabase, or the table isn't
 * there yet): the game works the same without them.
 */

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  date: z.string().max(10),
  player: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Bad player id."),
  guesses: z
    .array(z.array(z.number().int().positive().max(100_000)).length(CONN_GROUP_SIZE))
    .min(1)
    .max(CONN_GROUPS + CONN_MAX_MISTAKES + 4),
});

async function accountId(request: NextRequest): Promise<string | null> {
  if (!sessionTokenHash(request)) return null;
  try {
    return (await userFromRequest(request))?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-result:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const { date, player, guesses } = parsed.data;
  try {
    const account = await accountId(request);
    const out = await recordConnResult({ date, identity: account ? `u:${account}` : `d:${player}`, guesses });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const body: ConnResultResponse = out.summary ? { available: true, summary: out.summary } : { available: false };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    // Stats are a bonus: the game goes on without them.
    console.error("[connections] record failed:", err);
    return NextResponse.json({ available: false } satisfies ConnResultResponse, { headers: NO_STORE });
  }
}
