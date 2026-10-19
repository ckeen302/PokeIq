import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DLE_HINT_KINDS } from "@/lib/dle-types";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { DLE_PLAYER_RE, recordDleResult } from "@/lib/server/dle-results";
import type { DleResultResponse } from "@/lib/dle-community";

/**
 * POST /api/pokedle/result { date, player, guesses, hard?, hints?: ("genus" | "silhouette")[] }
 *
 * Records a finished daily Pokédle for the community stats and returns
 * where it puts you (DleResultResponse). The server plays `guesses` again,
 * so the result can't be made up (and hard mode only counts if
 * every guess fit); the first result per trainer and day is
 * kept, and sending it again (a reload) just returns that one. `player` is
 * the random id the browser keeps; a signed-in trainer counts as their
 * account instead, on every device.
 *
 * { available: false } when community stats are off (no Supabase, or the
 * table isn't there yet).
 */

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  date: z.string().max(10),
  player: z.string().regex(DLE_PLAYER_RE, "Bad player id."),
  guesses: z.array(z.number().int().positive().max(100_000)).min(1).max(12),
  hard: z.boolean().optional(),
  hints: z.array(z.enum(DLE_HINT_KINDS)).max(DLE_HINT_KINDS.length).optional(),
});

/** The signed-in trainer's account, if any (one lookup, only with a session cookie). */
async function accountId(request: NextRequest): Promise<string | null> {
  if (!sessionTokenHash(request)) return null;
  try {
    return (await userFromRequest(request))?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!rateLimit(`dle-result:${clientIp(request)}`, 30, 0.5)) {
    return tooManyRequests();
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const { date, player, guesses, hard, hints } = parsed.data;

  try {
    const account = await accountId(request);
    const out = await recordDleResult({ date, identity: account ? `u:${account}` : `d:${player}`, guesses, hard, hints });
    if (out && !out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const body: DleResultResponse = out ? { available: true, you: out.you } : { available: false };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error("[dle-results] record failed:", err);
    return NextResponse.json({ error: "Couldn't save your result." }, { status: 503, headers: NO_STORE });
  }
}
