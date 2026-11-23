import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { optionalName } from "@/lib/name-filter";
import { startHunt } from "@/lib/server/hunt";
import { HUNT_MAP_REGIONS, HUNT_MODES } from "@/lib/hunt/types";

/**
 * POST /api/geo/hunt — start a Pokémon Hunt: { mode, region?, date?, recent?, name? }.
 * Returns the game's token and the first Pokémon. Where it lives stays on the
 * server until a round is graded.
 */

const bodySchema = z.object({
  mode: z.enum(HUNT_MODES),
  region: z.enum(HUNT_MAP_REGIONS).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  recent: z.array(z.string().max(40)).max(200).optional(),
  name: z.string().trim().max(24).optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`hunt-start:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Too many games started. Take a breather." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const outcome = startHunt({ ...parsed.data, name: optionalName(parsed.data.name) });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(outcome.body, { headers: { "Cache-Control": "no-store" } });
}
