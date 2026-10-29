import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { secretIsSecure } from "@/lib/server/crypto";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { readStreakResult } from "@/lib/server/geo-streak";
import { GEO_REGION_STREAK_BOARD } from "@/lib/geo-streak-types";

/** POST /api/geo/streak/leaderboard — { resultToken, playerName }. The streak comes only from the signed result. */

const bodySchema = z.object({
  resultToken: z.string().min(10).max(2048),
  playerName: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N} _.\-']+$/u, "Use letters, numbers, spaces, _ . - ' only")
    .refine(isCleanName, NAME_REJECTED),
});

const RESULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-streak-lb:${clientIp(request)}`, 10, 0.1)) {
    return NextResponse.json({ error: "Too many submissions — try again in a minute." }, { status: 429 });
  }
  const supabase = getServiceSupabase();
  if (!supabase) return NextResponse.json({ saved: false, reason: "Persistence not configured" });
  if (process.env.NODE_ENV === "production" && !secretIsSecure()) {
    return NextResponse.json({ error: "Leaderboard disabled until the server secret is configured." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const result = readStreakResult(parsed.data.resultToken);
  if (!result) return NextResponse.json({ error: "Invalid result token." }, { status: 400 });
  if (Date.now() - result.finishedAt > RESULT_MAX_AGE_MS) return NextResponse.json({ error: "This result is too old to submit." }, { status: 410 });
  if (result.streak < 1) return NextResponse.json({ error: "Name at least one region to get on the board." }, { status: 400 });

  const { error } = await supabase.from("geo_runs").insert({
    session_id: result.sid,
    player_name: parsed.data.playerName,
    mode: GEO_REGION_STREAK_BOARD,
    daily_date: null,
    score: Math.min(25000, result.streak),
    duration_ms: result.durationMs,
  });
  if (error?.code === "23505") return NextResponse.json({ error: "This run is already on the board." }, { status: 409 });
  if (error) {
    console.error("[geo-streak-leaderboard] insert failed:", error.message);
    return NextResponse.json({ error: "Couldn't save your streak." }, { status: 503 });
  }
  return NextResponse.json({ saved: true });
}
