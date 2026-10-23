import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { RankedUnavailable, newAnonId, rankedIdentity } from "@/lib/server/ranked";
import { connRankedKey, connRankedStore } from "@/lib/server/connections-ranked";
import { SEASON_RE, connSeasonEnd, connSeasonOf, type ConnRankedResponse } from "@/lib/connections/ranked";

/**
 * GET /api/connections/ranked[?top=1][&season=YYYY-MM] — your ranked
 * PokéConnections standing this season (header x-ranked-id: the signed id
 * /api/pokedle/ranked gave this browser, which this shares; a signed-in
 * trainer is their account instead), and with ?top=1 the season's top 100.
 * Ratings restart every month. { available: false } while ranked play is off
 * (no store, or migration 0031 hasn't been applied).
 */

const NO_STORE = { "Cache-Control": "no-store" };
const querySchema = z.object({ top: z.enum(["1"]).optional(), season: z.string().regex(SEASON_RE).optional() });
const idSchema = z.string().min(10).max(200).nullable();

export async function GET(request: NextRequest) {
  if (!rateLimit(`conn-ranked:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const sent = idSchema.safeParse(request.headers.get("x-ranked-id"));
  if (!query.success || !sent.success) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const current = connSeasonOf(Date.now());
  const season = query.data.season && query.data.season <= current ? query.data.season : current;

  let identity = await rankedIdentity(request, sent.data);
  let id: string | undefined;
  if (!identity) {
    id = newAnonId();
    identity = await rankedIdentity(request, id);
  }
  const store = connRankedStore(season);
  if (!store) return NextResponse.json({ available: false, id, season } satisfies ConnRankedResponse, { headers: NO_STORE });
  try {
    const [you, top] = await Promise.all([store.standing(connRankedKey(identity!)), query.data.top ? store.top(100) : undefined]);
    return NextResponse.json({ available: true, id, season, endsAt: connSeasonEnd(season), you, top } satisfies ConnRankedResponse, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RankedUnavailable) return NextResponse.json({ available: false, id, season } satisfies ConnRankedResponse, { headers: NO_STORE });
    console.error("[connections-ranked]", err);
    return NextResponse.json({ error: "Ranked hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
