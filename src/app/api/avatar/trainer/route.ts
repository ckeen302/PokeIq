import { NextRequest, NextResponse } from "next/server";
import { USERNAME_RE, userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { avatarStore, avatarUnlocks, chooseTrainer, ownAvatar, ownTrainer, publicTrainerByName } from "@/lib/server/avatars";
import type { PublicTrainer, TrainerSettings } from "@/lib/trainer/client";

/**
 * 3D trainer avatars.
 * GET /api/avatar/trainer?name=<trainer>: anyone's public trainer config
 *     and small avatar ({ username, trainer | null, avatar }); 404 for no
 *     such account.
 * GET /api/avatar/trainer: the signed-in account's own trainer and unlocks.
 * PUT /api/avatar/trainer <TrainerConfig>: saves it, every choice checked
 *     against the account's badges and ranked tiers.
 * DELETE /api/avatar/trainer: removes it (small avatars show the Pokémon again).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`trainer:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  try {
    const name = request.nextUrl.searchParams.get("name");
    if (name !== null) {
      if (!USERNAME_RE.test(name)) return NextResponse.json({ error: "No such trainer." }, { status: 404, headers: NO_STORE });
      const found = await publicTrainerByName(name);
      if (!found) return NextResponse.json({ error: "No such trainer." }, { status: 404, headers: NO_STORE });
      const body: PublicTrainer = found;
      return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
    }
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to make your trainer." }, { status: 401, headers: NO_STORE });
    const [trainer, unlocks, avatar] = await Promise.all([ownTrainer(user), avatarUnlocks(user.id), ownAvatar(user)]);
    const settings: TrainerSettings = { available: !!avatarStore()?.savesTrainer(), trainer, unlocks, avatar };
    return NextResponse.json(settings, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}

async function save(request: NextRequest, raw: unknown) {
  const user = await userFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to make your trainer." }, { status: 401, headers: NO_STORE });
  const out = await chooseTrainer(user, raw);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
  return NextResponse.json({ ok: true, trainer: out.trainer, avatar: out.avatar }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const blocked = guardAuthRequest(request, "trainer", 20);
  if (blocked) return blocked;
  try {
    const text = await request.text();
    if (text.length > 2048) return NextResponse.json({ error: "That trainer isn't one the creator can make." }, { status: 400, headers: NO_STORE });
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    if (raw === null || raw === undefined) return NextResponse.json({ error: "That trainer isn't one the creator can make." }, { status: 400, headers: NO_STORE });
    return await save(request, raw);
  } catch (err) {
    return serverError(err);
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = guardAuthRequest(request, "trainer", 20);
  if (blocked) return blocked;
  try {
    return await save(request, null);
  } catch (err) {
    return serverError(err);
  }
}
