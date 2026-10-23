import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CONN_GROUP_SIZE, CONN_GROUPS, CONN_MAX_MISTAKES } from "@/lib/connections/types";
import type { ConnHintResponse } from "@/lib/connections/social";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, PLAYER, whoIs } from "@/lib/server/connections-custom-http";
import { connPlayerKey } from "@/lib/server/connections-results";
import { requestHint } from "@/lib/server/connections-social";

/**
 * POST /api/connections/hint { date, player, guesses }
 *
 * The optional hint for today's daily: one Pokémon from the easiest group
 * not found yet ({ id, level }: its colour, never its name or the other
 * three). At most one per player per puzzle: the server records the first
 * and answers every later request with that same Pokémon. The record is also
 * how the result route knows a hint was used (it ranks below every hint-free
 * game), so it never depends on what the client says afterwards.
 *
 * { available: false } when hints can't be stored: the game works the same.
 */

const bodySchema = z.object({
  date: z.string().max(10),
  player: PLAYER.optional(),
  guesses: z.array(z.array(z.number().int().positive().max(100_000)).length(CONN_GROUP_SIZE)).max(CONN_GROUPS + CONN_MAX_MISTAKES + 4),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-hint:${clientIp(request)}`, 10, 0.2)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const who = await whoIs(request, parsed.data.player);
  if (!who) return NextResponse.json({ error: "Missing player id." }, { status: 400, headers: NO_STORE });
  try {
    const out = await requestHint({ date: parsed.data.date, guesses: parsed.data.guesses, player: connPlayerKey(who.identity) });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json(out.hint, { headers: NO_STORE });
  } catch (err) {
    console.error("[connections] hint failed:", err);
    return NextResponse.json({ available: false } satisfies ConnHintResponse, { headers: NO_STORE });
  }
}
