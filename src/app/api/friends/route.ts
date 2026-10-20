import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { USERNAME_RE } from "@/lib/server/auth";
import { communityRequest, friendsAction, NO_STORE, outcome } from "@/lib/server/community-route";
import {
  accountDirectory,
  answerRequest,
  blockUser,
  listFriends,
  removeFriend,
  requestFriend,
  requestFriendByName,
  setAppearOffline,
  unblockUser,
} from "@/lib/server/friends";
import { findUserById } from "@/lib/server/accounts";
import { seatIn, encounterKey } from "@/lib/server/community-games";
import { CHALLENGE_KINDS } from "@/lib/community";

/**
 * GET /api/friends: the signed-in trainer's friends (online status, what
 * they're playing, their latest dailies), requests both ways, blocked
 * trainers and their "appear offline" setting.
 *
 * POST /api/friends { action, username }:
 *   request | accept | decline | remove (also takes back a request) | block | unblock
 *   { action: "request", via: { kind, code, token } }  the opponent of a battle or duel just played
 *   { action: "appear-offline", on }
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await communityRequest(request, "friends-list", { capacity: 20, perMinute: 20 });
  if (ctx instanceof NextResponse) return ctx;
  return friendsAction(async () => NextResponse.json(await listFriends(ctx.store, accountDirectory, ctx.user), { headers: NO_STORE }));
}

const username = z.string().regex(USERNAME_RE, "No trainer by that name.");
const bodySchema = z.union([
  z.object({ action: z.enum(["request", "accept", "decline", "remove", "block", "unblock"]), username }),
  z.object({ action: z.literal("request"), via: z.object({ kind: z.enum(CHALLENGE_KINDS), code: z.string().regex(/^[a-hjkmnp-z2-9]{8}$/), token: z.string().max(400) }) }),
  z.object({ action: z.literal("appear-offline"), on: z.boolean() }),
]);

export async function POST(request: NextRequest) {
  const ctx = await communityRequest(request, "friends-act", { capacity: 20, perMinute: 15 });
  if (ctx instanceof NextResponse) return ctx;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;
  const { store, user } = ctx;
  return friendsAction(async () => {
    if (body.action === "appear-offline") {
      await setAppearOffline(store, user, body.on);
      return outcome({ ok: true });
    }
    if ("via" in body) {
      // The opponent of a game both sat in: their account, from the seat they registered.
      const seat = await seatIn(body.via.kind, body.via.code, body.via.token).catch(() => null);
      const other = seat?.players.find((p) => p !== seat.me);
      const otherId = other ? await store.encounter(encounterKey(body.via.kind, body.via.code, other), Date.now()) : null;
      const target = otherId ? await findUserById(otherId) : null;
      if (!target) return NextResponse.json({ error: "Your opponent isn't signed in." }, { status: 404, headers: NO_STORE });
      return outcome(await requestFriend(store, user, target));
    }
    switch (body.action) {
      case "request":
        return outcome(await requestFriendByName(store, accountDirectory, user, body.username));
      case "accept":
      case "decline":
        return outcome(await answerRequest(store, accountDirectory, user, body.username, body.action === "accept"));
      case "remove":
        return outcome(await removeFriend(store, accountDirectory, user, body.username));
      case "block":
        return outcome(await blockUser(store, accountDirectory, user, body.username));
      case "unblock":
        return outcome(await unblockUser(store, accountDirectory, user, body.username));
    }
  });
}
