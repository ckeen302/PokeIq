import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { puzzleOfTheDay } from "@/lib/server/connections-creators";

/**
 * GET /api/connections/potd
 *
 * The Puzzle of the Day ({ available, puzzle }): the top-voted community
 * puzzle of the last week, picked once a day. Title, creator and votes
 * only; the puzzle itself plays at /connections/c/<id>.
 */

export async function GET(request: NextRequest) {
  if (!rateLimit(`conn-potd:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  try {
    return NextResponse.json(await puzzleOfTheDay(), { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } });
  } catch (err) {
    console.error("[connections] puzzle of the day failed:", err);
    return NextResponse.json({ available: false, puzzle: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
