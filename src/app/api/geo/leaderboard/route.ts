import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { secretIsSecure, verifyToken } from "@/lib/server/crypto";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { geoBoardKey, type GeoResult } from "@/lib/geo-types";

/** POST /api/geo/leaderboard — { resultToken, playerName }. The score comes only from the signed result. */

const bodySchema = z.object({
  resultToken: z.string().min(10).max(8192),
  playerName: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N} _.\-']+$/u, "Use letters, numbers, spaces, _ . - ' only"),
});

const RESULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-lb:${clientIp(request)}`, 10, 0.1)) {
    return NextResponse.json({ error: "Too many submissions." }, { status: 429 });
  }
  const supabase = getServiceSupabase();
  if (!supabase) return NextResponse.json({ saved: false, reason: "Persistence not configured" });
  if (process.env.NODE_ENV === "production" && !secretIsSecure()) {
    return NextResponse.json({ error: "Leaderboard disabled until the server secret is configured." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const result = verifyToken<GeoResult>("geo-result", parsed.data.resultToken);
  if (!result) return NextResponse.json({ error: "Invalid result token." }, { status: 400 });
  if (Date.now() - result.finishedAt > RESULT_MAX_AGE_MS) {
    return NextResponse.json({ error: "This result is too old to submit." }, { status: 410 });
  }
  if (result.spec.practice) {
    const why =
      result.spec.practice === "challenge"
        ? "Challenge replays aren't ranked: start your own game to get on the board."
        : "Only your first daily game of the day can be ranked.";
    return NextResponse.json({ error: why }, { status: 403 });
  }

  const { error } = await supabase.from("geo_runs").insert({
    session_id: result.sid,
    player_name: parsed.data.playerName,
    mode: geoBoardKey(result.spec),
    daily_date: result.spec.daily ?? null,
    score: result.score,
    duration_ms: result.durationMs,
  });
  if (error?.code === "23505") {
    return NextResponse.json({ error: "Already on the board (one entry per name per daily)." }, { status: 409 });
  }
  if (error) {
    console.error("[geo-leaderboard] insert failed:", error.message);
    return NextResponse.json({ error: "Couldn't save your score." }, { status: 503 });
  }
  return NextResponse.json({ saved: true });
}
