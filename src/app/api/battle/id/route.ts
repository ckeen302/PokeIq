import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { newAnonId, readAnonId } from "@/lib/server/ranked";

/**
 * GET /api/battle/id (header x-ranked-id: the id this browser has, if any):
 * { id } — a new signed anonymous id when the browser has none (or a bad
 * one), else {}. Battles, the ladder and "My replays" know a trainer who
 * isn't signed in by it (it's the same id ranked Pokédle uses).
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-id:${clientIp(request)}`, 10, 0.2)) return tooManyRequests();
  const have = readAnonId(request.headers.get("x-ranked-id"));
  return NextResponse.json(have ? {} : { id: newAnonId() }, { headers: NO_STORE });
}
