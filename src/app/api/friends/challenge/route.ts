import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { USERNAME_RE } from "@/lib/server/auth";
import { communityRequest, friendsAction, NO_STORE, outcome } from "@/lib/server/community-route";
import { accountDirectory, answerChallenge, cancelChallenge, sendChallenge } from "@/lib/server/friends";
import { challengeGame } from "@/lib/server/community-games";
import { CHALLENGE_KINDS } from "@/lib/community";

/**
 * POST /api/friends/challenge
 *   { action: "send", to, kind, code, token }  challenge a friend to the battle or duel you just opened
 *                                              (your seat token proves it's yours, still in its lobby)
 *   { action: "accept" | "decline", id }       answer a challenge (accept returns the invite page)
 *   { action: "cancel", id }                   take one back
 */

export const dynamic = "force-dynamic";

const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
const ID_RE = /^[a-hjkmnp-z2-9]{12}$/;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), to: z.string().regex(USERNAME_RE, "No trainer by that name."), kind: z.enum(CHALLENGE_KINDS), code: z.string().regex(CODE_RE), token: z.string().max(400) }),
  z.object({ action: z.literal("accept"), id: z.string().regex(ID_RE) }),
  z.object({ action: z.literal("decline"), id: z.string().regex(ID_RE) }),
  z.object({ action: z.literal("cancel"), id: z.string().regex(ID_RE) }),
]);

export async function POST(request: NextRequest) {
  const ctx = await communityRequest(request, "friends-challenge", { capacity: 12, perMinute: 10 });
  if (ctx instanceof NextResponse) return ctx;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;
  if (body.action === "send" || body.action === "accept") {
    const blocked = await gate(request, "play");
    if (blocked) return blocked;
  }
  const { store, user } = ctx;
  return friendsAction(async () => {
    if (body.action === "send") {
      const game = await challengeGame(body.kind, body.code, body.token);
      if (!game.ok) return outcome(game);
      return outcome(await sendChallenge(store, accountDirectory, user, body.to, { kind: body.kind, code: body.code, label: game.label }));
    }
    if (body.action === "cancel") return outcome(await cancelChallenge(store, user, body.id));
    return outcome(await answerChallenge(store, user, body.id, body.action === "accept"));
  });
}
