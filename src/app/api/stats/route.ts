/**
 * POST /api/stats — record a finished run against the signed-in account.
 * The server owns the aggregation (bests, totals, XP); the client only
 * reports the run summary, and Zod caps every field.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { QUIZ_CATEGORIES } from "@/engines/types";
import { userFromRequest } from "@/lib/auth";
import { getRank, recordStats } from "@/lib/auth-store";

export const runtime = "nodejs";

const schema = z.object({
  category: z.enum([...QUIZ_CATEGORIES, "daily"] as unknown as [
    string,
    ...string[],
  ]),
  mode: z.enum(["classic", "survival", "daily"]),
  score: z.number().int().min(0).max(10_000),
  correctCount: z.number().int().min(0).max(500),
  totalQuestions: z.number().int().min(1).max(500),
  bestStreak: z.number().int().min(0).max(500),
});

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run summary" }, { status: 400 });
  }
  const stats = await recordStats(user.id, {
    ...parsed.data,
    mode: parsed.data.mode,
  });
  const rank = await getRank(user.id);
  return NextResponse.json({ ok: true, stats, rank });
}
