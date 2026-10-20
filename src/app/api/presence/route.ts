import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { communityRequest, friendsAction, NO_STORE } from "@/lib/server/community-route";
import { accountDirectory, heartbeat } from "@/lib/server/friends";
import { battleActivity } from "@/lib/server/community-games";
import { roomById } from "@/lib/rooms";
import { matchNotes } from "@/lib/server/tournaments/service";
import { ACTIVITY_KINDS, activityLabel, type FriendActivity } from "@/lib/community";

/**
 * POST /api/presence { kind, code? }: the signed-in trainer's heartbeat,
 * about once a minute while a tab is visible (none while hidden). Marks them
 * online for PRESENCE_TTL_MS with what they're doing (the server picks the
 * words; a battle is named only if they're seated in it) and returns what's
 * waiting: friend requests, challenges, answers to their challenges, and tournament matches ready to play.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({ kind: z.enum(ACTIVITY_KINDS).default("browsing"), code: z.string().regex(/^[a-hjkmnp-z2-9]{8}$/).optional(), room: z.string().max(20).optional() });

export async function POST(request: NextRequest) {
  // A tab beats once a minute; a few tabs and quick page changes fit easily.
  const ctx = await communityRequest(request, "presence", { capacity: 12, perMinute: 8 });
  if (ctx instanceof NextResponse) return ctx;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const { kind, code, room } = parsed.data;
  return friendsAction(async () => {
    const chatRoom = kind === "room" && room ? roomById(room) : undefined;
    const activity: FriendActivity =
      kind === "battle" && code
        ? await battleActivity(code, ctx.user.id)
        : chatRoom
          ? { kind, label: `In the ${chatRoom.name} room`, room: chatRoom.id }
          : { kind, label: activityLabel(kind) };
    const beat = await heartbeat(ctx.store, accountDirectory, ctx.user, activity);
    // Tournament matches waiting for them (their tournaments move on as they do); never worth failing the heartbeat over.
    const matches = await matchNotes(ctx.user.id).catch(() => []);
    return NextResponse.json({ ...beat, matches }, { headers: NO_STORE });
  });
}
