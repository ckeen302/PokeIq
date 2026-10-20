import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { friendStore } from "@/lib/server/friends-store";
import { usersByIds } from "@/lib/server/accounts";
import { roomById } from "@/lib/rooms";

/**
 * GET /api/rooms/:id/users: the signed-in trainers in the room right now,
 * from presence (trainers who chose "appear offline" aren't listed). The
 * CDN keeps it for 20 s.
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!rateLimit(`room-users:${clientIp(request)}`, 30, 0.5)) return tooManyRequests();
  const { id } = await context.params;
  if (!roomById(id)) return NextResponse.json({ error: "There's no such room." }, { status: 404 });
  let users: string[] = [];
  try {
    const here = (await friendStore()?.roomPresence(Date.now(), id, 300)) ?? [];
    users = (await usersByIds(here.map((p) => p.userId))).map((u) => u.username).sort((a, b) => a.localeCompare(b));
  } catch {
    // Presence isn't there yet.
  }
  return NextResponse.json({ users }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=20" } });
}
