import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { gradeGeo, readGeo, regionGroupOf } from "@/lib/server/geo";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { geoStatsKey, logRoundScore } from "@/lib/server/geo-round-scores";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { GEO_FAMILY_IDS } from "@/lib/geo-families";

/**
 * POST /api/geo/guess — { token, x, y, family? } (x, y normalised 0–1 on the
 * region map; `family`: "guess the game too", the game family named;
 * `timeout`: the Timer setting's clock ran out with no pin down, so no points).
 */

const bodySchema = z.object({
  token: z.string().min(10).max(4096),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  family: z.enum(GEO_FAMILY_IDS as [string, ...string[]]).optional(),
  timeout: z.boolean().optional(),
});

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
  // Each shot's real difficulty: how players score on it (a timed-out round says nothing about the shot).
  // Signed-in trainers' rounds also carry who, where and what, for their profile's stats.
  if (!outcome.body.timedOut) {
    const spec = state.spec;
    const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
    const region = regionGroupOf(outcome.body.answer.region);
    void logRoundScore({
      shot: outcome.shot,
      score: outcome.body.score,
      mode: spec.daily ? "daily" : spec.practice === "challenge" ? "challenge" : "solo",
      kind: spec.kind === "streak" ? "streak" : spec.daily ? "daily" : spec.practice === "challenge" ? "challenge" : "game",
      run: state.sid,
      family: outcome.body.answer.family,
      ...(region ? { region } : {}),
      ...(user ? { player: geoStatsKey(`u:${user.id}`) } : {}),
      ...(spec.kind === "streak" ? { hit: outcome.body.hit } : {}),
    });
  }
  return NextResponse.json(outcome.body, { headers: { "Cache-Control": "no-store" } });
}
