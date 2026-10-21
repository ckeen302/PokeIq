import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { avatarStore, avatarUnlocks, chooseAvatar, ownStoredAvatar } from "@/lib/server/avatars";
import { pictureSettings } from "@/lib/server/avatar-uploads";
import type { AvatarSettings } from "@/lib/avatar";

/**
 * GET /api/avatar: the signed-in trainer's avatar, what they've unlocked,
 *     and their own pictures (the approved one, the one waiting for review).
 * PUT /api/avatar { pokemonId, shiny, frame, usePicture? }: saves a new
 *     pick, checked on the server against the account's level and ranked
 *     tiers. `usePicture`: show their approved picture instead.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`avatar:${clientIp(request)}`, 30, 1)) return tooManyRequests();
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to pick an avatar." }, { status: 401, headers: NO_STORE });
    const [stored, unlocks, pictures] = await Promise.all([ownStoredAvatar(user), avatarUnlocks(user.id), pictureSettings(user)]);
    const settings: AvatarSettings = {
      available: !!avatarStore()?.saves(),
      avatar: { pokemonId: stored.pokemonId, shiny: stored.shiny, frame: stored.frame },
      usePicture: !!stored.usePicture,
      unlocks,
      pictures,
    };
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
    return NextResponse.json({ ok: true, avatar: out.avatar, usePicture: out.usePicture }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}
