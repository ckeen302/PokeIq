import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { gradeStreak, readStreak, recordStreakRun } from "@/lib/server/geo-streak";
import { geoStatsKey, logRoundScore } from "@/lib/server/geo-round-scores";
import { GEO_STREAK_REGIONS } from "@/lib/geo-streak-types";

/**
 * POST /api/geo/streak/guess — { token, region } (or { token, timeout: true }
 * when the clock ran out). Graded here: right keeps the run going and deals
 * the next screenshot, wrong ends it with a signed result for the leaderboard.
 */

const bodySchema = z
  .object({
    token: z.string().min(10).max(4096),
    region: z.enum(GEO_STREAK_REGIONS).optional(),
    timeout: z.boolean().optional(),
  })
  .refine((b) => b.region !== undefined || b.timeout === true, "Pick a region.");

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-streak-guess:${clientIp(request)}`, 40, 1)) {
    return NextResponse.json({ error: "Slow down, explorer." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const state = readStreak(parsed.data.token);
  if (!state) return NextResponse.json({ error: "Run expired or invalid — start a new one." }, { status: 401 });

  const outcome = gradeStreak(state, parsed.data);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  // Each round is picked once; an identical retry (lost response) gets the same answer back.
  const fingerprint = requestFingerprint(parsed.data.token, parsed.data.region ?? "", parsed.data.timeout ? "timeout" : "");
  if (!(await claimOnce(outcome.claimKey))) {
    const cached = recallResponse(outcome.claimKey, fingerprint);
    if (cached) return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "That round was already picked." }, { status: 409 });
  }

  // Signed-in trainers: the round goes on their record, and a finished run on their best.
  const user = sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
  const player = user ? geoStatsKey(`u:${user.id}`) : undefined;
  const body = { ...outcome.body };
  if (player && body.done) {
    const best = await recordStreakRun(player, body.streak);
    if (best) body.best = best;
  }
  rememberResponse(outcome.claimKey, fingerprint, body);
  if (!body.timedOut) {
    void logRoundScore({
      shot: outcome.shot,
      score: body.correct ? 5000 : 0,
      mode: "region-streak",
      kind: "region-streak",
      hit: body.correct,
      run: state.sid,
      ...(player ? { player } : {}),
      ...(outcome.region ? { region: outcome.region } : {}),
      family: body.answer.family,
    });
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
