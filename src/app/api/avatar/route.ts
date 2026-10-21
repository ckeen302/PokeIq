import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { avatarStore, avatarUnlocks, chooseAvatar, ownAvatar } from "@/lib/server/avatars";
import type { AvatarSettings } from "@/lib/avatar";

/**
 * GET /api/avatar: the signed-in trainer's avatar and what they've unlocked.
 * PUT /api/avatar { pokemonId, shiny, frame }: saves a new pick, checked on
 * the server against the account's level and ranked tiers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`avatar:${clientIp(request)}`, 30, 1)) return tooManyRequests();
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to pick an avatar." }, { status: 401, headers: NO_STORE });
    const [avatar, unlocks] = await Promise.all([ownAvatar(user), avatarUnlocks(user.id)]);
    const settings: AvatarSettings = { available: !!avatarStore()?.saves(), avatar, unlocks };
    return NextResponse.json(settings, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}

export async function PUT(request: NextRequest) {
  const blocked = guardAuthRequest(request, "avatar", 20);
  if (blocked) return blocked;
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to pick an avatar." }, { status: 401, headers: NO_STORE });
    const out = await chooseAvatar(user, await request.json().catch(() => null));
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json({ ok: true, avatar: out.avatar }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}
