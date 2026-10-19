import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BATTLE_FORMAT_IDS } from "@/lib/battle/formats";
import { randomTeam } from "@/lib/server/battle";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

/** POST /api/battle/random { format } -> { sets }: six random-battle sets legal in the format. */

const bodySchema = z.object({ format: z.enum(BATTLE_FORMAT_IDS) });

export async function POST(request: NextRequest) {
  if (!rateLimit(`battle-random:${clientIp(request)}`, 20, 0.5)) {
    return NextResponse.json({ error: "Too many random teams — slow down a little." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown format." }, { status: 400 });
  }
  return NextResponse.json({ sets: randomTeam(parsed.data.format) }, { headers: { "Cache-Control": "no-store" } });
}
