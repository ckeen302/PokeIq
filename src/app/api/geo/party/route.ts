import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel";
import { duelsEnabled } from "@/lib/server/duel-store";
import { createParty, isPartyMap, newPartyCode, partyStore, partyToken, partyView } from "@/lib/server/geo-party";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { realtimeClientConfig } from "@/lib/server/realtime";
import { WORLD_REGION } from "@/lib/geo-types";
import type { PartySeatResponse } from "@/lib/geo-party";

/**
 * POST /api/geo/party — { name, region?, mode? }: open a PokéGuessr party
 * room (Battle Royale by default, or a team duel) with its host in it.
 * Returns its six-letter code, the host's seat token and the lobby; friends
 * join at /guessr/party/<code>, where the host sets the game up and starts it.
 */

const bodySchema = z.object({
  name: duelNameSchema,
  region: z.string().max(20).default(WORLD_REGION),
  mode: z.enum(["royale", "team"]).default("royale"),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`geo-party-new:${clientIp(request)}`, 10, 0.2)) {
    return NextResponse.json({ error: "Too many parties opened. Take a breather." }, { status: 429 });
  }
  if (!duelsEnabled()) return NextResponse.json({ error: "Parties aren't enabled on this server yet." }, { status: 503 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const blocked = await gate(request, "play");
  if (blocked) return blocked;
  await syncHiddenShots();
  const { name, mode } = parsed.data;
  const region = isPartyMap(parsed.data.region) ? parsed.data.region : WORLD_REGION;
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const now = Date.now();
      const { party, playerId } = createParty(newPartyCode(), name, region, now, mode);
      if (!(await partyStore.insert(party))) continue; // code taken: roll another
      const body: PartySeatResponse = { code: party.code, token: partyToken(party.code, playerId, name), view: { ...partyView(party, playerId, now, 0), live: realtimeClientConfig() } };
      return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Couldn't open a party. Try again." }, { status: 503 });
  } catch (err) {
    console.error("[geo-party] create failed:", err);
    return NextResponse.json({ error: "Couldn't open a party. Try again." }, { status: 503 });
  }
}
