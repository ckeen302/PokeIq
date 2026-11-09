import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { crowdDayOver, isCrowdDate } from "@/lib/geo-crowd";
import { crowdAccess, dailyCrowd, dailyRoundAnswer } from "@/lib/server/geo-crowd";
import { geoRegions } from "@/lib/server/geo";
import { guessrCrowdCard } from "@/lib/og/guessr-crowd";

/**
 * GET /api/geo/crowd/card?date=YYYY-MM-DD&round=N&t=<result token> — a share
 * picture (1200 × 630 PNG) of one Daily round's crowd map: with the answer's
 * flag once the day is over, the whole map without it while the Daily is in play. The same spoiler guard as /api/geo/crowd: a day that's over, or the
 * sharer's own finished Daily. 404 while the round has too few pins.
 */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-crowd-card:${clientIp(request)}`, 10, 0.2)) return NextResponse.json({ error: "Slow down." }, { status: 429 });
  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  const round = Number(params.get("round"));
  if (!isCrowdDate(date) || !Number.isInteger(round) || round < 1 || round > 10) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (!crowdAccess(date, params.get("t"))) return NextResponse.json({ error: "Finish the Daily to see where everyone pinned." }, { status: 403 });
  const [crowd, answer] = [(await dailyCrowd(date)).rounds.find((r) => r.round === round), dailyRoundAnswer(date, round)];
  const region = answer && geoRegions().find((r) => r.id === answer.region);
  if (!crowd || !answer || !region) return NextResponse.json({ error: "No crowd map for that round yet." }, { status: 404 });
  const headers = crowdDayOver(date) ? { "cache-control": "public, max-age=3600, s-maxage=3600" } : { "cache-control": "private, max-age=300" };
  // A shared picture travels to people who haven't played today: the answer's flag only once the day is over.
  return guessrCrowdCard({ date, crowd, flag: crowdDayOver(date) ? (answer.answer.spot ?? answer.answer.pin) : null, region, headers });
}
