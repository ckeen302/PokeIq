import { NextRequest, NextResponse } from "next/server";
import { isValidDailyDate } from "@/lib/daily";
import { geoDailyFirstShot } from "@/lib/server/geo";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { syncShotScores } from "@/lib/server/geo-round-scores";

/**
 * GET /api/geo/daily-shot?date=YYYY-MM-DD — the Daily's first picture on the
 * player's local date, for the home page: `{ shot, blur? }`. Only the
 * picture's URL (a random id) and its blurred placeholder: no place, region or
 * pin. The same for everyone on that date, so the CDN keeps it for a while
 * (a screenshot hidden after a report drops out of the Daily within the hour,
 * as it does in the game).
 */
export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  if (!isValidDailyDate(date)) return NextResponse.json({ error: "That daily isn't available." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  // The same screenshots the Daily deals from (reported ones hidden, the audit's scores in).
  await Promise.all([syncHiddenShots(), syncShotScores()]);
  const first = geoDailyFirstShot(date);
  if (!first) return NextResponse.json({ error: "No daily on that date." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(first, { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=600" } });
}
