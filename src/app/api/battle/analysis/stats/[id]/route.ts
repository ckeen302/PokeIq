import { NextRequest, NextResponse } from "next/server";
import { STATS_VERSION } from "@/lib/battle/analysis/stats-types";
import { REPLAY_ID_RE } from "@/lib/battle/replay";
import { battleStats } from "@/lib/server/battle-stats";
import { ReplaysUnavailable, replayStore } from "@/lib/server/battle-engine/replays";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

/**
 * GET /api/battle/analysis/stats/<replay id>?v=<STATS_VERSION> -> { stats }:
 * a finished battle's stats (damage per Pokémon, KOs, luck against the
 * odds, what happened each turn), worked out from its saved log. Asked for
 * only by the replay's analysis panel, after the battle; a replay never
 * changes, so the answer is cached here and by the CDN.
 */

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
// Keyed by the stats' version (the query): a new version is a new URL.
const CACHED = { "Cache-Control": "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!REPLAY_ID_RE.test(id)) return NextResponse.json({ error: "No such replay." }, { status: 404, headers: NO_STORE });
  if (!rateLimit(`battle-stats:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  try {
    const replay = await replayStore()?.get(id);
    if (!replay) return NextResponse.json({ error: "No such replay." }, { status: 404, headers: NO_STORE });
    const stats = await battleStats(replay);
    const current = request.nextUrl.searchParams.get("v") === String(STATS_VERSION);
    return NextResponse.json({ stats }, { headers: current ? CACHED : NO_STORE });
  } catch (err) {
    if (err instanceof ReplaysUnavailable) return NextResponse.json({ error: "Replays aren't available right now." }, { status: 503, headers: NO_STORE });
    console.error("[battle-stats]", err);
    return NextResponse.json({ error: "Couldn't work out this battle's stats." }, { status: 500, headers: NO_STORE });
  }
}
