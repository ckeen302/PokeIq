import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { getServiceSupabase } from "@/lib/supabase";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { secretIsSecure, verifyToken } from "@/lib/server/crypto";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { LEADERBOARD_TAG, fetchBoard, practiceMessage } from "@/lib/server/leaderboard";
import type { RunResult } from "@/lib/session-types";

/**
 * GET  /api/leaderboard?daily=YYYY-MM-DD | ?iq=1 | ?module=whos-that&format=classic&difficulty=medium
 * POST /api/leaderboard { resultToken, playerName }
 *
 * The POST body carries no score at all — only the server-signed result
 * token minted when the run finished. Scores can't be typed in, edited, or
 * submitted twice.
 */

const submissionSchema = z.object({
  resultToken: z.string().min(10).max(8192),
  playerName: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N} _.\-']+$/u, "Use letters, numbers, spaces, _ . - ' only")
    .refine(isCleanName, NAME_REJECTED),
});

const RESULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;


export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const daily = params.get("daily");
  const entries = daily
    ? await fetchBoard({ kind: "daily", date: daily })
    : params.get("iq")
      ? await fetchBoard({ kind: "iq" })
      : await fetchBoard({
          kind: "module",
          module: params.get("module") ?? "whos-that",
          format: params.get("format") ?? undefined,
          difficulty: params.get("difficulty") ?? undefined,
        });
  return NextResponse.json(
    { entries: entries ?? [], persistenceEnabled: entries !== null },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } }
  );
}

export async function POST(request: NextRequest) {
  if (!rateLimit(`lb:${clientIp(request)}`, 10, 0.1)) {
    return NextResponse.json({ error: "Too many submissions — try again in a minute." }, { status: 429 });
  }
  const supabase = getServiceSupabase();
  if (!supabase) return NextResponse.json({ saved: false, reason: "Persistence not configured" });
  // With the public dev secret anyone could mint a result token.
  if (process.env.NODE_ENV === "production" && !secretIsSecure()) {
    return NextResponse.json({ error: "Leaderboard disabled until the server secret is configured." }, { status: 503 });
  }

  const parsed = submissionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const result = verifyToken<RunResult>("result", parsed.data.resultToken);
  if (!result) return NextResponse.json({ error: "Invalid result token." }, { status: 400 });
  if (Date.now() - result.finishedAt > RESULT_MAX_AGE_MS) {
    return NextResponse.json({ error: "This result is too old to submit." }, { status: 410 });
  }
  const practice = practiceMessage(result);
  if (practice) return NextResponse.json({ error: practice }, { status: 403 });
  const { error } = await supabase.from("runs").insert({
    session_id: result.sid,
    player_name: parsed.data.playerName,
    module: result.spec.module,
    format: result.spec.format,
    difficulty: result.spec.difficulty,
    gens: result.spec.gens ?? null,
    daily_date: result.spec.daily ?? null,
    score: result.score,
    correct: result.correct,
    total: result.total,
    best_streak: result.bestStreak,
    pokeiq: result.pokeiq,
    duration_ms: result.durationMs,
  });

  if (error) {
    // Unique constraints enforce one submission per run and one daily entry per name.
    if (error.code === "23505") {
      const message = error.message.includes("runs_session_id_key")
        ? "This run was already submitted."
        : "That name already has a score on this daily board.";
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[api/leaderboard] insert failed:", error.message);
    return NextResponse.json({ error: "Could not save score" }, { status: 503 });
  }
  revalidateTag(LEADERBOARD_TAG);
  return NextResponse.json({ saved: true }, { status: 201 });
}
