import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { crowdDayOver, isCrowdDate } from "@/lib/geo-crowd";
import { crowdAccess, dailyCrowd } from "@/lib/server/geo-crowd";

/**
 * GET /api/geo/crowd?date=YYYY-MM-DD&t=<result token> — where everyone pinned
 * each round of that day's PokéGuessr Daily, as a coarse grid of counts on
 * its map (src/lib/geo-crowd.ts). Never before the asker has finished that
 * Daily (`t`: the signed result the game gave them) unless the day is over
 * everywhere: 403 otherwise. Rounds with too few pins are left out, so an
 * empty list means "nothing to show yet".
 */
export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-crowd:${clientIp(request)}`, 30, 0.5)) return NextResponse.json({ error: "Slow down." }, { status: 429 });
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  if (!isCrowdDate(date)) return NextResponse.json({ error: "Bad date." }, { status: 400 });
  if (!crowdAccess(date, params.get("t"))) {
    return NextResponse.json({ error: "Finish the Daily to see where everyone pinned." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const crowd = await dailyCrowd(date);
  // A finished day is the same for everyone (the CDN may share it); today's answer is only for the trainer who asked.
  const cache = crowdDayOver(date) ? "public, max-age=300, s-maxage=300" : "private, max-age=30";
  return NextResponse.json(crowd, { headers: { "Cache-Control": cache } });
}
