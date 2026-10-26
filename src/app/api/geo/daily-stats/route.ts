import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { COMPARE_MAX, dailyStats } from "@/lib/geo-compare";

/**
 * GET /api/geo/daily-stats?date=YYYY-MM-DD&score=N — how a Daily's ranked
 * games (geo_runs) spread out, and how many scored under `score`. Without
 * Supabase (or with no games yet) it says there were 0 players, and the
 * summary screen shows no comparison.
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-stats:${clientIp(request)}`, 30, 0.5)) return NextResponse.json({ error: "Slow down." }, { status: 429 });
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return NextResponse.json({ error: "Bad date." }, { status: 400 });
  const raw = params.get("score");
  const score = raw !== null && /^\d{1,5}$/.test(raw) && Number(raw) <= COMPARE_MAX ? Number(raw) : undefined;

  const supabase = getServiceSupabase();
  let scores: number[] = [];
  if (supabase) {
    const { data, error } = await supabase.from("geo_runs").select("score").eq("daily_date", date).limit(20_000);
    if (error) console.error("[geo-daily-stats] read failed:", error.message);
    else scores = ((data ?? []) as { score: number }[]).map((r) => r.score);
  }
  return NextResponse.json(dailyStats(date, scores, score), { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
}
