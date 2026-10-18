import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidDailyDate } from "@/lib/daily";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { isGeoSpec, startGeo } from "@/lib/server/geo";
import { GEO_STYLES, type GeoSpec } from "@/lib/geo-types";

/**
 * POST /api/geo — start a PokéGuessr game.
 *   { region: "kanto", style: "classic" | "retro" }   free play
 *   { daily: "YYYY-MM-DD" }                            the daily game (same five places for everyone)
 */

const DAILY_COOKIE = "piq_geo_daily";

const DAILY_REGION = "kanto";

const bodySchema = z.object({
  region: z.string().max(20).default(DAILY_REGION),
  style: z.enum(GEO_STYLES).default("classic"),
  daily: z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-start:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Too many games started — take a breather." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  let spec: GeoSpec;
  const started = (request.cookies.get(DAILY_COOKIE)?.value ?? "").split(",").filter(Boolean);
  if (parsed.data.daily !== undefined) {
    if (!isValidDailyDate(parsed.data.daily)) {
      return NextResponse.json({ error: "That daily game isn't available." }, { status: 400 });
    }
    spec = { region: DAILY_REGION, style: "classic", daily: parsed.data.daily };
    if (started.includes(parsed.data.daily)) spec.practice = "repeat-daily";
  } else {
    spec = { region: parsed.data.region, style: parsed.data.style };
    if (!isGeoSpec(spec)) return NextResponse.json({ error: "Unknown region." }, { status: 400 });
  }

  const game = startGeo(spec);
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
