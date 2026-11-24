import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { playerRateLimit } from "@/lib/server/rate-limit";
import { signToken, verifyToken } from "@/lib/server/crypto";
import { geoKept, pauseGeo, readGeo, resumeGeo, type GeoPause } from "@/lib/server/geo";

/**
 * POST /api/geo/clock — the Daily's (or the Weekly's) round clock, as the
 * player leaves and comes back (lib/server/geo.ts has the rules).
 *   { token, action: "pause", left? }  the player is leaving (Exit, the tab hidden or closed, a reload):
 *                                      the round's clock stops. `left`: ms on their clock (left out
 *                                      before it has started). Sent as the page goes, so its answer
 *                                      may never be read: the pause is kept in a cookie.
 *   { token, action: "resume" }        the player is back: { token, left }, the round going on from
 *                                      the pause, and the time left on its clock. The pause is then
 *                                      spent; sent again within 30 s (a lost answer), the same answer.
 * The time the server counts comes from its own clock, never from the browser:
 * a pause stops it where it was, and only a pause the server saw does.
 */

const CLOCK_COOKIE = "piq_geo_clock";
/** Pauses kept: a Daily and a Weekly can each be left part played, with room for a day's overlap. */
const KEEP = 4;

const bodySchema = z.object({
  token: z.string().min(10).max(4096),
  action: z.enum(["pause", "resume"]),
  left: z.number().min(0).max(3_600_000).optional(),
});

function readPauses(request: NextRequest): GeoPause[] {
  const list = verifyToken<GeoPause[]>("geo-clock", request.cookies.get(CLOCK_COOKIE)?.value);
  return Array.isArray(list)
    ? list.filter((p) => p && typeof p.sid === "string" && Number.isInteger(p.round) && Number.isFinite(p.used) && Number.isFinite(p.left) && Number.isFinite(p.at) && (p.resumedAt === undefined || Number.isFinite(p.resumedAt)))
    : [];
}

function writePauses(response: NextResponse, pauses: GeoPause[]) {
  response.cookies.set(CLOCK_COOKIE, pauses.length ? signToken("geo-clock", pauses.slice(0, KEEP)) : "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/geo",
    // A Weekly can be left on its Monday and finished on Sunday.
    maxAge: pauses.length ? 9 * 24 * 60 * 60 : 0,
  });
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const state = parsed.success ? readGeo(parsed.data.token) : null;
  if (!playerRateLimit(request, "geo-clock", 30, 1, state?.sid)) return NextResponse.json({ error: "Slow down, explorer." }, { status: 429 });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (!state) return NextResponse.json({ error: "Game expired or invalid — start a new one." }, { status: 401 });
  if (!geoKept(state.spec)) return NextResponse.json({ error: "Only the Daily and the Weekly are kept to come back to." }, { status: 400 });

  const pauses = readPauses(request);
  const mine = pauses.find((p) => p.sid === state.sid);
  const others = pauses.filter((p) => p.sid !== state.sid);
  const headers = { "Cache-Control": "no-store" };
  if (parsed.data.action === "pause") {
    // An older token (a round already played) never replaces a later round's pause.
    const pause = mine && mine.round > state.log.length ? null : pauseGeo(state, parsed.data.left);
    const response = NextResponse.json({ paused: !!pause, ...(pause ? { left: pause.left } : {}) }, { headers });
    if (pause) writePauses(response, [pause, ...others]);
    return response;
  }
  const resumed = resumeGeo(state, mine);
  const response = NextResponse.json({ token: resumed.token, left: resumed.left }, { headers });
  // Used (kept briefly, so a resume sent again gets the same answer), spent, or left behind by a later round. A later round's pause stays.
  if (resumed.keep) writePauses(response, [resumed.keep, ...others]);
  else if (mine && mine.round <= state.log.length) writePauses(response, others);
  return response;
}
