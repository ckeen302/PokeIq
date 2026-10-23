import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, PLAYER, whoIs } from "@/lib/server/connections-custom-http";
import { connPlayerKey } from "@/lib/server/connections-results";
import { isFeaturedCreator } from "@/lib/server/connections-creators";

/**
 * POST /api/connections/featured { player }
 *
 * Whether one of this trainer's community puzzles is featured or has been
 * the Puzzle of the Day: { featured }. The page awards the "Featured
 * creator" badge when it is true.
 */

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-featured:${clientIp(request)}`, 20, 0.2)) return tooManyRequests();
  const parsed = z.object({ player: PLAYER.optional() }).safeParse(await request.json().catch(() => ({})));
  const who = parsed.success ? await whoIs(request, parsed.data.player) : null;
  if (!who) return NextResponse.json({ featured: false }, { headers: NO_STORE });
  try {
    return NextResponse.json({ featured: await isFeaturedCreator(connPlayerKey(who.identity)) }, { headers: NO_STORE });
  } catch (err) {
    console.error("[connections] featured check failed:", err);
    return NextResponse.json({ featured: false }, { headers: NO_STORE });
  }
}
