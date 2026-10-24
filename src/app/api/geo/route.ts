import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidDailyDate } from "@/lib/daily";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { optionalName } from "@/lib/name-filter";
import { geoFilter, isGeoSpec, readGeoChallenge, startGeo } from "@/lib/server/geo";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { GEO_FILTER_MIN_PLACES, GEO_KINDS, GEO_ROUND_OPTIONS, WORLD_REGION, geoDailyRegion, isGeoRounds, type GeoRounds, type GeoSpec } from "@/lib/geo-types";
import { GEO_ERAS, GEO_FAMILY_IDS } from "@/lib/geo-families";

/**
 * POST /api/geo — start a PokéGuessr game.
 *   { region, kind, era?, families?, recent? }  free play: "game" (5 rounds) or "streak" (until a miss),
 *                             on every game's screenshots or an era's ("2d" / "3d"); picked
 *                             `families` narrow it further (practice: not ranked).
 *                             `recent` lists the areas the player just saw, so they don't come straight back
 *   { daily: "YYYY-MM-DD" }   the daily game (same five places for everyone, every game)
 *   { challenge: "<token>" }  a friend's exact five places (not ranked)
 * `guessGame: true` adds "guess the game too" (five-round games): bonus points
 * for naming each screenshot's game, kept apart from the ranked score.
 * An optional `name` is shown to friends on the challenge link (left off if it isn't fit to show).
 */

const DAILY_COOKIE = "piq_geo_daily";

const bodySchema = z.object({
  region: z.string().max(20).default(WORLD_REGION),
  kind: z.enum(GEO_KINDS).default("game"),
  era: z.enum(GEO_ERAS).optional(),
  families: z.array(z.enum(GEO_FAMILY_IDS as [string, ...string[]])).max(GEO_FAMILY_IDS.length).optional(),
  guessGame: z.boolean().optional(),
  /** Game length: 3, 5 or 10 (default 5; the Daily is always 5). */
  rounds: z.number().refine((n) => (GEO_ROUND_OPTIONS as readonly number[]).includes(n), "Pick 3, 5 or 10 rounds.").optional(),
  daily: z.string().optional(),
  challenge: z.string().max(2048).optional(),
  recent: z.array(z.string().max(100)).max(200).optional(),
  name: z.string().trim().max(24).optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-start:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Too many games started — take a breather." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  await syncHiddenShots();

  let spec: GeoSpec;
  let seed: string | undefined;
  let plan: string | undefined;
  const started = (request.cookies.get(DAILY_COOKIE)?.value ?? "").split(",").filter(Boolean);
  if (body.daily !== undefined) {
    if (!isValidDailyDate(body.daily)) {
      return NextResponse.json({ error: "That daily game isn't available." }, { status: 400 });
    }
    // The daily is always every game's screenshots.
    const region = geoDailyRegion(body.daily, isGeoSpec({ region: WORLD_REGION, kind: "game" }));
    spec = { region, kind: "game", daily: body.daily };
    if (started.includes(body.daily)) spec.practice = "repeat-daily";
  } else if (body.challenge) {
    const challenge = readGeoChallenge(body.challenge);
    if (!challenge) return NextResponse.json({ error: "That challenge link isn't valid." }, { status: 400 });
    // The link carries the game length: one score per round.
    const rounds = challenge.rounds.length;
    spec = { region: challenge.region, kind: "game", practice: "challenge", ...(rounds !== 5 && isGeoRounds(rounds) ? { rounds } : {}), ...geoFilter(challenge.era, challenge.families) };
    seed = challenge.seed;
    plan = challenge.plan;
  } else {
    const filter = geoFilter(body.era, body.families);
    spec = { region: body.region, kind: body.kind, ...filter };
    if (body.kind === "game" && body.rounds && body.rounds !== 5) spec.rounds = body.rounds as GeoRounds;
    if (filter.families) spec.practice = "filtered";
  }
  if (body.guessGame && spec.kind === "game") spec.guessGame = true;
  if (!isGeoSpec(spec)) {
    const error =
      spec.era || spec.families
        ? `Too few places on this map for those games (at least ${GEO_FILTER_MIN_PLACES} are needed). Pick more games or another map.`
        : "Unknown region.";
    return NextResponse.json({ error }, { status: 400 });
  }

  const game = startGeo(spec, { seed, plan, name: optionalName(body.name), recent: body.recent });
  const response = NextResponse.json({ ...game, region: spec.region, practice: spec.practice }, { headers: { "Cache-Control": "no-store" } });
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
