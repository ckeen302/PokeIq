import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PLAY_FORMAT_INFO, PLAY_FORMATS } from "@/lib/battle/play";
import { quickTeam, towerQuickTeam } from "@/lib/server/battle-engine/teams";
import { customRandomTeam } from "@/lib/server/battle-engine/custom";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

/**
 * POST /api/battle/quick { format } -> { sets }: a ready-to-battle team, legal in the format.
 * { rules } instead: a team legal under that custom ruleset; { tower: true }: one for the Battle Tower.
 */

export const runtime = "nodejs";

const bodySchema = z.union([
  z.object({ format: z.enum(PLAY_FORMATS).refine((f) => !PLAY_FORMAT_INFO[f].random) }),
  z.object({ rules: z.record(z.unknown()) }),
  z.object({ tower: z.literal(true) }),
]);

export async function POST(request: NextRequest) {
  if (!rateLimit(`battle-quick:${clientIp(request)}`, 20, 0.5)) {
    return NextResponse.json({ error: "Too many quick teams — slow down a little." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown format." }, { status: 400 });
  }
  const body = parsed.data;
  try {
    const sets = "tower" in body ? towerQuickTeam() : "rules" in body ? customRandomTeam(body.rules as never) : quickTeam(body.format);
    return NextResponse.json({ sets }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't deal a quick team." }, { status: 400 });
  }
}
