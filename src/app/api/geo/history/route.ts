import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { newAnonId, rankedIdentity } from "@/lib/server/ranked";
import { geoRankedKey } from "@/lib/server/geo-ranked";
import { HISTORY_PAGE, HistoryUnavailable, historyItemFor, historyStore } from "@/lib/server/geo-duel-history";
import type { GeoDuelHistoryItem, GeoDuelHistoryResponse } from "@/lib/geo-duel-history";

/**
 * GET /api/geo/history[?before=<ms>] — your PokéGuessr duels, newest first,
 * a page at a time (`next` is the `before` for the next page, null at the
 * end). You are your account when signed in, else the signed id your browser
 * sends in x-ranked-id (a browser without one gets a new `id` to keep).
 * { available: false } while duel history is off here (migration 0049).
 */

const NO_STORE = { "Cache-Control": "no-store" };
const querySchema = z.object({ before: z.coerce.number().int().positive().optional() });
const idSchema = z.string().min(10).max(200).nullable();

export async function GET(request: NextRequest) {
  if (!rateLimit(`geo-history:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  const sent = idSchema.safeParse(request.headers.get("x-ranked-id"));
  if (!query.success || !sent.success) return NextResponse.json({ error: "Bad request." }, { status: 400, headers: NO_STORE });

  let identity = await rankedIdentity(request, sent.data);
  let id: string | undefined;
  if (!identity) {
    id = newAnonId();
    identity = await rankedIdentity(request, id);
  }
  const store = historyStore();
  if (!store || !identity) return NextResponse.json({ available: false, id } satisfies GeoDuelHistoryResponse, { headers: NO_STORE });
  const key = geoRankedKey(identity);
  try {
    // One extra row says whether there's another page.
    const rows = await store.list(key, query.data.before ?? null, HISTORY_PAGE + 1);
    const page = rows.slice(0, HISTORY_PAGE);
    const duels = page.map((r) => historyItemFor(r, key)).filter((d): d is GeoDuelHistoryItem => d !== null);
    const next = rows.length > HISTORY_PAGE ? page[page.length - 1].endedAt : null;
    return NextResponse.json({ available: true, id, duels, next } satisfies GeoDuelHistoryResponse, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof HistoryUnavailable) return NextResponse.json({ available: false, id } satisfies GeoDuelHistoryResponse, { headers: NO_STORE });
    console.error("[geo-history]", err);
    return NextResponse.json({ error: "History hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
