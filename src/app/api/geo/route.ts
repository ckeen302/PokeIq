import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidDailyDate } from "@/lib/daily";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { isGeoSpec, readGeoChallenge, startGeo } from "@/lib/server/geo";
import { GEO_KINDS, GEO_STYLES, type GeoSpec } from "@/lib/geo-types";

/**
 * POST /api/geo — start a PokéGuessr game.
 *   { region, style, kind }   free play: "game" (5 rounds) or "streak" (until a miss)
 *   { daily: "YYYY-MM-DD" }   the daily game (same five places for everyone)
 *   { challenge: "<token>" }  a friend's exact five places (not ranked)
 * An optional `name` is shown to friends on the challenge link.
 */

const DAILY_COOKIE = "piq_geo_daily";
const DAILY_REGION = "kanto";

const bodySchema = z.object({
  region: z.string().max(20).default(DAILY_REGION),
  style: z.enum(GEO_STYLES).default("classic"),
  kind: z.enum(GEO_KINDS).default("game"),
  daily: z.string().optional(),
  challenge: z.string().max(2048).optional(),
  name: z.string().trim().max(24).optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-start:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Too many games started — take a breather." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;

  let spec: GeoSpec;
  let seed: string | undefined;
  const started = (request.cookies.get(DAILY_COOKIE)?.value ?? "").split(",").filter(Boolean);
  if (body.daily !== undefined) {
    if (!isValidDailyDate(body.daily)) {
      return NextResponse.json({ error: "That daily game isn't available." }, { status: 400 });
    }
    spec = { region: DAILY_REGION, style: "classic", kind: "game", daily: body.daily };
    if (started.includes(body.daily)) spec.practice = "repeat-daily";
  } else if (body.challenge) {
    const challenge = readGeoChallenge(body.challenge);
    if (!challenge) return NextResponse.json({ error: "That challenge link isn't valid." }, { status: 400 });
    spec = { region: challenge.region, style: challenge.style, kind: "game", practice: "challenge" };
    seed = challenge.seed;
  } else {
    spec = { region: body.region, style: body.style, kind: body.kind };
  }
  if (!isGeoSpec(spec)) return NextResponse.json({ error: "Unknown region." }, { status: 400 });

  const game = startGeo(spec, { seed, name: body.name });
  const response = NextResponse.json({ ...game, practice: spec.practice }, { headers: { "Cache-Control": "no-store" } });
  if (spec.daily && !spec.practice) {
    response.cookies.set(DAILY_COOKIE, [spec.daily, ...started].slice(0, 4).join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/geo",
      maxAge: 3 * 24 * 60 * 60,
    });
  }
  return response;
}
