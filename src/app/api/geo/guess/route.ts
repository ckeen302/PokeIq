import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { gradeGeo, readGeo } from "@/lib/server/geo";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { logRoundScore, roundFlag } from "@/lib/server/geo-round-scores";
import { deriveSeed, randomId } from "@/lib/server/crypto";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { GEO_FAMILY_IDS } from "@/lib/geo-families";

/**
 * POST /api/geo/guess — { token, x, y, family?, timeout? } (x, y normalised
 * 0–1 on the region map; `family`: "guess the game too", the game family
 * named; `timeout`: the Timer setting's clock ran out with no pin down, so
 * no points). Kept lean: it's on the warm path and every round goes through it.
 *
 * The rules (geo.ts has them): one guess per round (a second is a 409, an
 * identical retry gets the same answer back), a pin after the round's clock
 * plus a grace scores nothing, and a daily is graded only on its day. Each
 * graded round is logged with who played it (an HMAC of the account, or of
 * a device id kept in a cookie) and a behaviour flag, for the moderators.
 */

const DEVICE_COOKIE = "piq_geo_id";
const DEVICE_RE = /^[A-Za-z0-9_-]{12,32}$/;

const bodySchema = z.object({
  token: z.string().min(10).max(4096),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  family: z.enum(GEO_FAMILY_IDS as [string, ...string[]]).optional(),
  timeout: z.boolean().optional(),
});

/** The trainer behind a request, for the round log: their account when signed in, else their device. Never blocks the answer. */
async function playerOf(request: NextRequest, device: string): Promise<{ key: string; name: string | null }> {
  if (sessionTokenHash(request)) {
    const user = await userFromRequest(request).catch(() => null);
    if (user) return { key: deriveSeed("geo-player", `u:${user.id}`), name: user.username };
  }
  return { key: deriveSeed("geo-player", `d:${device}`), name: null };
}

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-guess:${clientIp(request)}`, 30, 1)) {
    return NextResponse.json({ error: "Slow down, explorer." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const state = readGeo(parsed.data.token);
  if (!state) return NextResponse.json({ error: "Game expired or invalid — start a new one." }, { status: 401 });

  await syncHiddenShots();
  const outcome = gradeGeo(state, parsed.data);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  // Each round can be guessed once; an identical retry (lost response) gets the same answer back.
  const fingerprint = requestFingerprint(parsed.data.token, String(parsed.data.x), String(parsed.data.y), parsed.data.family ?? "", parsed.data.timeout ? "timeout" : "");
  if (!(await claimOnce(outcome.claimKey))) {
    const cached = recallResponse(outcome.claimKey, fingerprint);
    if (cached) return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "That round was already guessed." }, { status: 409 });
  }
  rememberResponse(outcome.claimKey, fingerprint, outcome.body);

  const known = request.cookies.get(DEVICE_COOKIE)?.value;
  const device = known && DEVICE_RE.test(known) ? known : randomId(12);
  // Each shot's real difficulty (how players score on it) and the behaviour flags; a timed-out round says nothing about the shot.
  if (!outcome.body.timedOut) {
    const spec = state.spec;
    void playerOf(request, device).then((player) =>
      logRoundScore({
        shot: outcome.shot,
        score: outcome.body.score,
        mode: spec.daily ? "daily" : spec.practice === "challenge" ? "challenge" : "solo",
        player,
        game: state.sid,
        elapsedMs: outcome.played.elapsedMs,
        flag: roundFlag(outcome.played),
      })
    );
  }
  const response = NextResponse.json(outcome.body, { headers: { "Cache-Control": "no-store" } });
  if (device !== known) {
    response.cookies.set(DEVICE_COOKIE, device, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/geo",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return response;
}
