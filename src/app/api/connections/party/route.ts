import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema, pvpToken } from "@/lib/server/duel-core";
import { duelsEnabled, newDuelCode } from "@/lib/server/duel-store";
import { createParty, partyStore, partyView } from "@/lib/server/connections-party";
import type { PartySeatResponse } from "@/lib/connections/party";

/**
 * POST /api/connections/party { name } — opens a party (2 to 8 trainers
 * racing one puzzle) and returns its code, the host's player token and the
 * lobby (PartySeatResponse). It plays at /connections/party/<code>.
 */

const bodySchema = z.object({ name: duelNameSchema });

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-party-new:${clientIp(request)}`, 10, 0.2)) {
    return NextResponse.json({ error: "Too many parties started — take a breather." }, { status: 429 });
  }
  if (!duelsEnabled()) return NextResponse.json({ error: "Parties aren't enabled on this server yet." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const blocked = await gate(request, "play");
  if (blocked) return blocked;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const code = newDuelCode();
      const { party, playerId } = createParty(parsed.data.name, code, now);
      if (!(await partyStore.insert(party))) continue; // code taken: roll another
      const seat: PartySeatResponse = { code, token: pvpToken(code, playerId), view: partyView(party, playerId, now, 0) };
      return NextResponse.json(seat, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Couldn't open a party. Try again." }, { status: 503 });
  } catch (err) {
    console.error("[party] create failed:", err);
    return NextResponse.json({ error: "Parties open soon. Try a duel for now." }, { status: 503 });
  }
}
