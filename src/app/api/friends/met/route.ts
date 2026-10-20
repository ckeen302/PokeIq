import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { communityRequest, friendsAction, NO_STORE } from "@/lib/server/community-route";
import { relationOf } from "@/lib/server/friends";
import { encounterKey, seatIn } from "@/lib/server/community-games";
import { CHALLENGE_KINDS, type MetResponse } from "@/lib/community";

/**
 * POST /api/friends/met { kind, code, token }: after a battle or duel, a
 * signed-in trainer registers their own seat (the token proves it), and
 * learns whether their opponent did too (an account to add) and where they
 * stand with them. Neither name is revealed: "Add friend" sends the request
 * through the game (POST /api/friends { action: "request", via }).
 */

export const dynamic = "force-dynamic";

/** Long enough to answer after a series of rematches. */
const ENCOUNTER_TTL_MS = 6 * 60 * 60 * 1000;

const bodySchema = z.object({ kind: z.enum(CHALLENGE_KINDS), code: z.string().regex(/^[a-hjkmnp-z2-9]{8}$/), token: z.string().max(400) });

export async function POST(request: NextRequest) {
  const ctx = await communityRequest(request, "friends-met", { capacity: 12, perMinute: 12 });
  if (ctx instanceof NextResponse) return ctx;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const { kind, code, token } = parsed.data;
  const { store, user } = ctx;
  return friendsAction(async () => {
    const seat = await seatIn(kind, code, token).catch(() => null);
    if (!seat) return NextResponse.json({ error: "You weren't in that game." }, { status: 404, headers: NO_STORE });
    const now = Date.now();
    await store.putEncounter(encounterKey(kind, code, seat.me), user.id, now + ENCOUNTER_TTL_MS);
    const other = seat.players.find((p) => p !== seat.me);
    const otherId = other ? await store.encounter(encounterKey(kind, code, other), now) : null;
    const body: MetResponse =
      otherId && otherId !== user.id ? { available: true, account: true, relation: await relationOf(store, user.id, otherId) } : { available: true, account: false };
    return NextResponse.json(body, { headers: NO_STORE });
  });
}
