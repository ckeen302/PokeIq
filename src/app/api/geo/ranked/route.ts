import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { RankedUnavailable, newAnonId, rankedIdentity } from "@/lib/server/ranked";
import { geoRankedKey, geoRankedStore } from "@/lib/server/geo-ranked";
import { geoSeasonOf, isGeoSeason } from "@/lib/geo-ranked";
import type { RankedResponse } from "@/lib/ranked";

/**
 * GET /api/geo/ranked[?top=1][&season=YYYY-MM] — your ranked PokéGuessr
 * standing in a season (the current one unless named; header x-ranked-id:
 * the signed id this endpoint or /api/pokedle/ranked gave your browser; a
 * signed-in trainer is their account instead), and with ?top=1 its top 100.
 *
 * A browser without a valid id gets a new one (`id`) to keep and send back.
 * { available: false } while ranked play is off (no store, or migration 0029
 * hasn't been applied).
 */

const NO_STORE = { "Cache-Control": "no-store" };
const querySchema = z.object({ top: z.enum(["1"]).optional(), season: z.string().refine(isGeoSeason, "Bad season.").optional() });
const idSchema = z.string().min(10).max(200).nullable();

export type GeoRankedResponse = RankedResponse & { season: string };

export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-ranked:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const sent = idSchema.safeParse(request.headers.get("x-ranked-id"));
  if (!query.success || !sent.success) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });
  const current = geoSeasonOf(Date.now());
  // Past seasons can be looked back on; the future can't.
  const season = query.data.season && query.data.season <= current ? query.data.season : current;

  let identity = await rankedIdentity(request, sent.data);
  let id: string | undefined;
  if (!identity) {
    id = newAnonId();
    identity = await rankedIdentity(request, id);
  }
  const store = geoRankedStore(season);
  if (!store) return NextResponse.json({ available: false, id, season } satisfies GeoRankedResponse, { headers: NO_STORE });
  try {
    const [you, top] = await Promise.all([store.standing(geoRankedKey(identity!)), query.data.top ? store.top(100) : undefined]);
    return NextResponse.json({ available: true, id, you, top, season } satisfies GeoRankedResponse, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RankedUnavailable) return NextResponse.json({ available: false, id, season } satisfies GeoRankedResponse, { headers: NO_STORE });
    console.error("[geo-ranked]", err);
    return NextResponse.json({ error: "Ranked hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
