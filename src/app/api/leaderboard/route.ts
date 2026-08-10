/**
 * Leaderboard API (Zod-validated).
 * GET  /api/leaderboard?category=whos-that → top 10
 * POST /api/leaderboard { name, category, score, streak, difficulty }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  QUIZ_CATEGORIES,
  type LeaderboardCategory,
} from "@/engines/types";
import { getTopScores, submitScore } from "@/lib/leaderboard-store";

const LEADERBOARD_CATEGORIES = [...QUIZ_CATEGORIES, "daily"] as const;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category") ?? "";
  if (!(LEADERBOARD_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }
  const { entries, persistent } = await getTopScores(
    category as LeaderboardCategory,
  );
  return NextResponse.json({ entries, persistent });
}

const submitSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(20)
    // visible characters only; no control chars
    .regex(/^[\p{L}\p{N}\p{P}\p{Zs}\p{Emoji}]+$/u, "Invalid characters in name"),
  category: z.enum(
    LEADERBOARD_CATEGORIES as unknown as [
      LeaderboardCategory,
      ...LeaderboardCategory[],
    ],
  ),
  score: z.number().int().min(0).max(10_000),
  streak: z.number().int().min(0).max(100),
  difficulty: z.enum(["easy", "medium", "hard", "mixed", "survival"]),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid submission", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { ok, persistent } = await submitScore(parsed.data);
  return NextResponse.json({ ok, persistent }, { status: ok ? 201 : 500 });
}
