import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { createDuel, duelNameSchema, duelToken, duelView, isDuelMap } from "@/lib/server/duel";
import { duelsEnabled, insertDuel, newDuelCode } from "@/lib/server/duel-store";
import { WORLD_REGION } from "@/lib/geo-types";
import type { DuelSeatResponse } from "@/lib/duel-types";

/**
 * POST /api/geo/duel — { region, name }: open a PokéGuessr duel on a map
 * (the world or a region). Returns its code, the creator's player token and
 * the lobby; the friend joins at /guessr/duel/<code>.
 */

const bodySchema = z.object({
  region: z.string().max(20).default(WORLD_REGION),
  name: duelNameSchema,
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-duel-new:${clientIp(request)}`, 10, 0.2)) {
    return NextResponse.json({ error: "Too many duels started — take a breather." }, { status: 429 });
  }
  if (!duelsEnabled()) {
    return NextResponse.json({ error: "Duels aren't enabled on this server yet." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { region, name } = parsed.data;
  const blocked = await gate(request, "play");
  if (blocked) return blocked;
  if (!isDuelMap(region)) return NextResponse.json({ error: "Unknown map." }, { status: 400 });

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const { duel, playerId } = createDuel(region, name, newDuelCode(), now);
      if (!(await insertDuel(duel))) continue; // code taken: roll another
      const body: DuelSeatResponse = { code: duel.code, token: duelToken(duel.code, playerId), view: duelView(duel, playerId, now, 0) };
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Couldn't open a duel. Try again." }, { status: 503 });
  } catch (err) {
    console.error("[geo-duel] create failed:", err);
    return NextResponse.json({ error: "Couldn't open a duel. Try again." }, { status: 503 });
  }
}
