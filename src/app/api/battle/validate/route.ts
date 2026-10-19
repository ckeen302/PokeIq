import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BATTLE_FORMAT_IDS } from "@/lib/battle/formats";
import { completeSet, setSchema } from "@/lib/battle/sets";
import { checkTeam } from "@/lib/server/battle";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

/**
 * POST /api/battle/validate { format, sets } -> { ok, team: string[], sets: string[][] }
 * Pokémon Showdown's team validator for the format; problems come back per set.
 */

const bodySchema = z.object({
  format: z.enum(BATTLE_FORMAT_IDS),
  // Up to 24 so an oversized team still gets the validator's own message.
  sets: z.array(setSchema).max(24),
});

export async function POST(request: NextRequest) {
  // The team builder re-checks as you edit: generous, but bounded.
  if (!rateLimit(`battle-validate:${clientIp(request)}`, 60, 2)) {
    return NextResponse.json({ error: "Too many checks — slow down a little." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That doesn't look like a team." }, { status: 400 });
  }
  const { format, sets } = parsed.data;
  return NextResponse.json(checkTeam(format, sets.map(completeSet)), { headers: { "Cache-Control": "no-store" } });
}
