import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { battleProfile } from "@/lib/server/battle-engine/records";
import { battlePlayerKey } from "@/lib/server/battle-engine/identity";
import type { BattleProfileResponse } from "@/lib/battle/profile";

/**
 * GET /api/battle/profile: your own battle record (header x-ranked-id: this
 * browser's signed id; a signed-in trainer is their account): wins and
 * losses per format, ladder ratings, and your latest battles.
 * { available: false } until records are on (migration 0018).
 * Public profiles of accounts are pages: /u/<name>.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-profile:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const key = await battlePlayerKey(request, request.headers.get("x-ranked-id"));
  if (!key) return NextResponse.json({ available: true, formats: [], recent: [] } satisfies BattleProfileResponse, { headers: NO_STORE });
  try {
    const profile = await battleProfile(key);
    return NextResponse.json((profile ? { available: true, ...profile } : { available: false }) satisfies BattleProfileResponse, { headers: NO_STORE });
  } catch (err) {
    console.error("[battle-profile]", err);
    return NextResponse.json({ error: "Couldn't load your battle record. Try again." }, { status: 503, headers: NO_STORE });
  }
}
