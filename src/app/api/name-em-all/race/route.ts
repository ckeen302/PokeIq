import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema, pvpToken } from "@/lib/server/duel-core";
import { duelsEnabled, newDuelCode } from "@/lib/server/duel-store";
import { createRace, raceStore, raceView } from "@/lib/server/name-em-all-race";
import { neaCategory } from "@/lib/name-em-all/categories";
import { neaTargets } from "@/lib/name-em-all/targets";
import { RACE_MINUTES, type NeaRaceSeatResponse } from "@/lib/name-em-all/race";

/**
 * POST /api/name-em-all/race { name, category, minutes } — opens a race
 * lobby and returns its code, the host's seat token and the lobby. It plays
 * at /quiz/name-em-all/race/<code>.
 */

const bodySchema = z.object({
  name: duelNameSchema,
  category: z.string().max(40),
  minutes: z.number().int().refine((m) => (RACE_MINUTES as readonly number[]).includes(m), "Pick a race length."),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`nea-race-new:${clientIp(request)}`, 10, 0.2)) {
    return NextResponse.json({ error: "Too many races started. Take a breather." }, { status: 429 });
  }
  if (!duelsEnabled()) return NextResponse.json({ error: "Races aren't enabled on this server yet." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (!neaCategory(parsed.data.category)) return NextResponse.json({ error: "No such category." }, { status: 400 });
  const blocked = await gate(request, "play");
  if (blocked) return blocked;
  const total = neaTargets(parsed.data.category)!.length;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const code = newDuelCode();
      const { race, playerId } = createRace(parsed.data.name, code, parsed.data.category, total, parsed.data.minutes, now);
      if (!(await raceStore.insert(race))) continue;
      const seat: NeaRaceSeatResponse = { code, token: pvpToken(code, playerId), view: raceView(race, playerId, now, 0) };
      return NextResponse.json(seat, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Couldn't open a race. Try again." }, { status: 503 });
  } catch (err) {
    console.error("[name-em-all race] create failed:", err);
    return NextResponse.json({ error: "Races open soon. Try a solo run for now." }, { status: 503 });
  }
}
