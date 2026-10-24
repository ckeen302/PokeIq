import { NextRequest, NextResponse } from "next/server";
import { USERNAME_RE } from "@/lib/server/auth";
import { findUserByName } from "@/lib/server/accounts";
import { aboutFor } from "@/lib/server/about";
import { aboutCard } from "@/lib/og/about";
import { LIVE_CARD_HEADERS } from "@/lib/og/card";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

/**
 * GET /u/<name>/about-image: a trainer's "About me" as a PNG (1200 × 630)
 * to share. `?download=1` sends it as a file. Public, like the profile.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  if (!rateLimit(`about-img:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  let name = "";
  try {
    name = decodeURIComponent((await params).name);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!USERNAME_RE.test(name)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await findUserByName(name).catch(() => null);
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const headers: Record<string, string> = { ...LIVE_CARD_HEADERS };
  if (request.nextUrl.searchParams.get("download") === "1") headers["content-disposition"] = `attachment; filename="pokeiq-${user.username}.png"`;
  return aboutCard(user.username, await aboutFor(user.id), headers);
}
