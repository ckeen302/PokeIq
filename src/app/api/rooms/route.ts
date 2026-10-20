import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { friendStore } from "@/lib/server/friends-store";
import { ROOMS } from "@/lib/rooms";

/**
 * GET /api/rooms: how many trainers are in each room right now (from
 * presence). The same for everyone, so the CDN keeps it for 30 s.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!rateLimit(`rooms-list:${clientIp(request)}`, 30, 0.5)) return tooManyRequests();
  const counts: Record<string, number> = Object.fromEntries(ROOMS.map((r) => [r.id, 0]));
  try {
    for (const p of (await friendStore()?.roomPresence(Date.now())) ?? []) if (p.room in counts) counts[p.room]++;
  } catch {
    // Presence isn't there yet: everyone reads 0.
  }
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" } });
}
