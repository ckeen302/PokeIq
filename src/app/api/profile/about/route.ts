import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/server/auth";
import { guardAuthRequest, serverError } from "@/lib/server/auth-route";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { aboutFor, aboutStore, saveAbout } from "@/lib/server/about";

/**
 * GET /api/profile/about: the signed-in trainer's own about-me.
 * PUT /api/profile/about { pokemon: {slot: {id, shiny}}, games: {slot: choice} }:
 *     replaces it, every pick checked on the server against the Pokédex and
 *     the fixed lists. Others see it on the public profile.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`about:${clientIp(request)}`, 30, 1)) return tooManyRequests();
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to edit your profile." }, { status: 401, headers: NO_STORE });
    return NextResponse.json({ available: !!aboutStore(), about: await aboutFor(user.id) }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}

export async function PUT(request: NextRequest) {
  const blocked = guardAuthRequest(request, "about", 20);
  if (blocked) return blocked;
  try {
    const user = await userFromRequest(request);
    if (!user) return NextResponse.json({ error: "Sign in to edit your profile." }, { status: 401, headers: NO_STORE });
    const out = await saveAbout(user.id, await request.json().catch(() => null));
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json({ ok: true, about: out.about }, { headers: NO_STORE });
  } catch (err) {
    return serverError(err);
  }
}
