import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { createDuel, duelNameSchema, duelToken, duelView, isDuelMap, parseDuelSettings } from "@/lib/server/duel";
import { duelsEnabled, insertDuel, newDuelCode } from "@/lib/server/duel-store";
import { WORLD_REGION } from "@/lib/geo-types";
import { GEO_ERAS } from "@/lib/geo-families";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import type { DuelSeatResponse } from "@/lib/duel-types";

/**
 * POST /api/geo/duel — { region, era?, name, mode?, rounds? }: open a PokéGuessr duel on a map
 * (the world or a region), on every game's screenshots or an era's. Returns its code, the creator's player token and
 * the lobby; the friend joins at /guessr/duel/<code>.
 */

const bodySchema = z.object({
  region: z.string().max(20).default(WORLD_REGION),
  era: z.enum(GEO_ERAS).optional(),
  name: duelNameSchema,
  /** "hp" (default) or "race" (a set number of rounds, highest total wins). */
  mode: z.string().max(10).optional(),
  /** Race only: 3, 5 or 10. */
  rounds: z.number().optional(),
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
  const { region, era, name } = parsed.data;
  const settings = parseDuelSettings(parsed.data.mode, parsed.data.rounds);
  if (!settings) return NextResponse.json({ error: "Pick HP battle, or a points race of 3, 5 or 10 rounds." }, { status: 400 });
  const blocked = await gate(request, "play");
  if (blocked) return blocked;
  await syncHiddenShots();
  if (!isDuelMap(region, era)) return NextResponse.json({ error: era ? "That map has too few places for those games." : "Unknown map." }, { status: 400 });

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const { duel, playerId } = createDuel(region, name, newDuelCode(), now, undefined, era, settings);
      if (settings.mode === "race" && duel.maxRounds !== settings.rounds) {
        return NextResponse.json({ error: `That map has too few places for a ${settings.rounds}-round race.` }, { status: 400 });
      }
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
