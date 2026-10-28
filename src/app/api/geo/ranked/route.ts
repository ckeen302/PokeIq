import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { RankedUnavailable, newAnonId, rankedIdentity } from "@/lib/server/ranked";
import { geoRankedConfig, geoRankedKey, geoRankedStore } from "@/lib/server/geo-ranked";
import { utcDay, type GeoRankedResponse } from "@/lib/geo-ranked";

/**
 * GET /api/geo/ranked[?top=1] — your ranked PokéGuessr standing (header
 * x-ranked-id: the signed id ranked play gave your browser, the same one as
 * Pokédle's; a signed-in trainer is their account instead), and with ?top=1
 * the top 100. Decay since your last duel is applied as you're read.
 *
 * A browser without a valid id gets a new one (`id`) to keep and send back.
 * { available: false } while ranked PokéGuessr is off (no store, or migration
 * 0043 hasn't been applied).
 */

const NO_STORE = { "Cache-Control": "no-store" };
const querySchema = z.object({ top: z.enum(["1"]).optional() });
const idSchema = z.string().min(10).max(200).nullable();

export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-ranked:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const sent = idSchema.safeParse(request.headers.get("x-ranked-id"));
  if (!query.success || !sent.success) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });

  let identity = await rankedIdentity(request, sent.data);
  let id: string | undefined;
  if (!identity) {
    id = newAnonId();
    identity = await rankedIdentity(request, id);
  }
  const store = geoRankedStore();
  if (!store) return NextResponse.json({ available: false, id } satisfies GeoRankedResponse, { headers: NO_STORE });
  try {
    const today = utcDay(Date.now());
    const [you, top] = await Promise.all([store.standing(geoRankedKey(identity!), today), query.data.top ? store.top(100, today) : undefined]);
    return NextResponse.json({ available: true, id, you, top, botAfterS: geoRankedConfig().botAfterS } satisfies GeoRankedResponse, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RankedUnavailable) return NextResponse.json({ available: false, id } satisfies GeoRankedResponse, { headers: NO_STORE });
    console.error("[geo-ranked]", err);
    return NextResponse.json({ error: "Ranked hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
