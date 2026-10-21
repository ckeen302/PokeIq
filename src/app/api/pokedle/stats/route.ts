import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { dleDaySummary, isStatsDate } from "@/lib/server/dle-results";
import type { DleStatsResponse } from "@/lib/dle-community";
import { isDailyFormat } from "@/lib/dle-format";

/**
 * GET /api/pokedle/stats?date=YYYY-MM-DD[&format=squirdle] — how everyone did on that day's
 * Pokédle (DleStatsResponse): trainers, solves, the guess distribution and
 * the most popular openers. The same for everyone, so the CDN keeps it for
 * 30 seconds; where *you* stand comes from POST /api/pokedle/result, never
 * from here. Nothing in it gives the answer away, but the page only shows
 * it once you've finished.
 *
 * { available: false } when community stats are off.
 */

const CACHED = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" };
const OFF = { "Cache-Control": "public, s-maxage=60" };
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`dle-stats:${clientIp(request)}`, 60, 2)) {
    return tooManyRequests();
  }
  const date = request.nextUrl.searchParams.get("date");
  if (!isStatsDate(date)) return NextResponse.json({ error: "No Pokédle that day." }, { status: 400, headers: NO_STORE });

  try {
    const format = request.nextUrl.searchParams.get("format") ?? "classic";
    if (!isDailyFormat(format)) return NextResponse.json({ error: "No such Pokédle." }, { status: 400, headers: NO_STORE });
    const summary = await dleDaySummary(date, undefined, format);
    const body: DleStatsResponse = summary ? { available: true, ...summary } : { available: false };
    return NextResponse.json(body, { headers: summary ? CACHED : OFF });
  } catch (err) {
    console.error("[dle-results] summary failed:", err);
    return NextResponse.json({ error: "Couldn't load today's stats." }, { status: 503, headers: NO_STORE });
  }
}
