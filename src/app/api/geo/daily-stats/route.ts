import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { crowdRateLimit } from "@/lib/server/rate-limit";
import { COMPARE_MAX, dailyStats } from "@/lib/geo-compare";

/**
 * GET /api/geo/daily-stats?date=YYYY-MM-DD&score=N — how a Daily's ranked
 * games (geo_runs) spread out, and how many scored under `score`. Without
 * Supabase (or with no games yet) it says there were 0 players, and the
 * summary screen shows no comparison.
 *
 * Every player asks with their own score, so the CDN can't share one answer:
 * the day's scores are read once per SCORES_TTL_MS per server instance
 * (concurrent requests wait on the same read) and every score is placed
 * against that list.
 */

const SCORES_TTL_MS = 30_000;
const recent = new Map<string, { at: number; scores: Promise<number[]> }>();

function dayScores(date: string): Promise<number[]> {
  const now = Date.now();
  const hit = recent.get(date);
  if (hit && now - hit.at < SCORES_TTL_MS) return hit.scores;
  const supabase = getServiceSupabase();
  if (!supabase) return Promise.resolve([]);
  if (recent.size > 20) recent.clear();
  const scores = (async () => {
    const { data, error } = await supabase.from("geo_runs").select("score").eq("daily_date", date).limit(20_000);
    if (error) {
      console.error("[geo-daily-stats] read failed:", error.message);
      // A failed read isn't kept: the next request tries again.
      recent.delete(date);
      return [];
    }
    return ((data ?? []) as { score: number }[]).map((r) => r.score);
  })().catch((err) => {
    console.error("[geo-daily-stats] read failed:", err);
    recent.delete(date);
    return [] as number[];
  });
  recent.set(date, { at: now, scores });
  return scores;
}

export async function GET(request: NextRequest) {
  if (!crowdRateLimit(request, "geo-stats", 30, 0.5)) return NextResponse.json({ error: "Slow down." }, { status: 429 });
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return NextResponse.json({ error: "Bad date." }, { status: 400 });
  const raw = params.get("score");
  const score = raw !== null && /^\d{1,5}$/.test(raw) && Number(raw) <= COMPARE_MAX ? Number(raw) : undefined;

  const scores = await dayScores(date);
  return NextResponse.json(dailyStats(date, scores, score), { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
}
