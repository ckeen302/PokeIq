import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { optionalName } from "@/lib/name-filter";
import { startHunt } from "@/lib/server/hunt";
import { HUNT_DIFFICULTIES, HUNT_MAP_REGIONS, HUNT_MODES } from "@/lib/hunt/types";

/**
 * POST /api/geo/hunt — start a Pokémon Hunt: { mode, region?, difficulty?, date?, recent?, name? }.
 * Returns the game's token and the first Pokémon. Where it lives stays on the server until a round is
 * graded. A Daily this device has already started plays again as practice (never on the board).
 */

const bodySchema = z.object({
  mode: z.enum(HUNT_MODES),
  region: z.enum(HUNT_MAP_REGIONS).optional(),
  difficulty: z.enum(HUNT_DIFFICULTIES).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  recent: z.array(z.string().max(40)).max(200).optional(),
  name: z.string().trim().max(24).optional(),
});

/** The Daily Hunts this device has started (the last few dates), like PokéGuessr's Daily cookie. */
const DAILY_COOKIE = "piq_hunt_daily";

export async function POST(request: NextRequest) {
  if (!rateLimit(`hunt-start:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Too many games started. Take a breather." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const started = (request.cookies.get(DAILY_COOKIE)?.value ?? "").split(",").filter(Boolean);
  const outcome = startHunt({ ...parsed.data, name: optionalName(parsed.data.name), repeat: parsed.data.mode === "daily" && !!parsed.data.date && started.includes(parsed.data.date) });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  const response = NextResponse.json(outcome.body, { headers: { "Cache-Control": "no-store" } });
  const daily = outcome.body.daily?.date;
  if (daily && !started.includes(daily)) {
    response.cookies.set(DAILY_COOKIE, [daily, ...started].slice(0, 4).join(","), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/geo/hunt",
      maxAge: 3 * 24 * 60 * 60,
    });
  }
  return response;
}
