import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel-core";
import { duelsEnabled } from "@/lib/server/duel-store";
import { cancelMatch, geoBotMatch, matchSettingsSchema, newTicket, searchGeoRanked, searchMatch, searchRankedConnections, searchRankedMatch } from "@/lib/server/matchmaking";
import { RankedUnavailable, rankedIdentity, rankedKey, rankedStore } from "@/lib/server/ranked";
import { connRankedKey, connRankedStore } from "@/lib/server/connections-ranked";
import { ensureGeoSeason, geoRankedConfig, geoRankedKey, geoRankedStore } from "@/lib/server/geo-ranked";
import { GEO_BOT_NAME_RE, GEO_ELO_START, utcDay } from "@/lib/geo-ranked";
import { RANKED_START } from "@/lib/ranked";

/**
 * POST /api/duel/match — find an opponent (PokéGuessr on a map, or Pokédle):
 *   { action: "search", settings, name, ticket? }   search, or poll a search (about once a second;
 *                                                   polling keeps it alive). Returns
 *                                                   { status: "waiting", ticket, since } or, once
 *                                                   paired, { status: "matched", code, token, href }
 *   { action: "cancel", settings, ticket }          give up the search
 *   { action: "bot", settings, ticket }             ranked PokéGuessr only: leave the queue for a duel against the
 *                                                   Gym Leader bot, once the search has waited long enough
 *                                                   (the waiting response's botAfterMs). Returns the matched seat.
 * settings: { game: "geo", region, ranked? }, { game: "pokedle", ranked? } or { game: "connections", ranked? }. A ranked search
 * also sends `rankedId` (the signed id ranked play gave this browser) unless signed in. While a ranked PokéGuessr search waits,
 * the response carries `botAfterMs`.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const ticket = z.string().regex(/^[\w-]{16}$/, "Bad ticket.");

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    settings: matchSettingsSchema,
    name: duelNameSchema,
    ticket: ticket.optional(),
    rankedId: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal("cancel"), settings: matchSettingsSchema, ticket }),
  z.object({ action: z.literal("bot"), settings: matchSettingsSchema, ticket }),
]);

export async function POST(request: NextRequest) {
  // A searching trainer polls about once a second.
  if (!rateLimit(`duel-match:${clientIp(request)}`, 30, 3)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  }
  if (!duelsEnabled()) {
    return NextResponse.json({ error: "Duels aren't enabled on this server yet." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (body.action === "search") {
    const blocked = await gate(request, "play");
    if (blocked) return blocked;
  }

  try {
    if (body.action === "cancel") {
      await cancelMatch(body.settings, body.ticket);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    const geoRanked = body.settings.game === "geo" && body.settings.ranked;
    if (body.action === "bot") {
      if (!geoRanked) return NextResponse.json({ error: "Only ranked PokéGuessr has Gym Leaders." }, { status: 400, headers: NO_STORE });
      const out = await geoBotMatch(body.ticket, geoRankedConfig());
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
      return NextResponse.json(out.status === "matched" ? { status: out.status, code: out.code, token: out.token, href: out.href } : { status: out.status }, { headers: NO_STORE });
    }
    const connRanked = body.settings.game === "connections" && body.settings.ranked;
    const ranked = (body.settings.game === "pokedle" && body.settings.ranked) || connRanked;
    let out: Awaited<ReturnType<typeof searchMatch>>;
    if (geoRanked) {
      const store = geoRankedStore();
      if (!store) return NextResponse.json({ error: "Ranked isn't open on this server yet." }, { status: 503, headers: NO_STORE });
      if (GEO_BOT_NAME_RE.test(body.name)) return NextResponse.json({ error: "Only the Gym Leaders are called that. Pick another name." }, { status: 400, headers: NO_STORE });
      const identity = await rankedIdentity(request, body.rankedId);
      if (!identity) return NextResponse.json({ error: "Reload the page to get your ranked card." }, { status: 400, headers: NO_STORE });
      const key = geoRankedKey(identity);
      // The first ranked action after a season boundary rolls the ladder over, so the queue matches on reset ratings.
      await ensureGeoSeason(store);
      try {
        out = await searchGeoRanked(body.name, body.ticket ?? newTicket(), key, async () => {
          const r = await store.rating(key, utcDay(Date.now()));
          return r ? { rating: r.elo, games: r.games } : { rating: GEO_ELO_START, games: 0 };
        }, geoRankedConfig());
      } catch (err) {
        if (err instanceof RankedUnavailable) return NextResponse.json({ error: "Ranked opens soon. Casual duels are on." }, { status: 409, headers: NO_STORE });
        throw err;
      }
    } else if (ranked) {
      const store = connRanked ? connRankedStore() : rankedStore();
      if (!store) return NextResponse.json({ error: "Ranked isn't open on this server yet." }, { status: 503, headers: NO_STORE });
      const identity = await rankedIdentity(request, body.rankedId);
      if (!identity) return NextResponse.json({ error: "Reload the page to get your ranked card." }, { status: 400, headers: NO_STORE });
      const key = connRanked ? connRankedKey(identity) : rankedKey(identity);
      try {
        const search = connRanked ? searchRankedConnections : searchRankedMatch;
        out = await search(body.name, body.ticket ?? newTicket(), key, async () => (await store.rating(key)) ?? { rating: RANKED_START, games: 0 });
      } catch (err) {
        if (err instanceof RankedUnavailable) return NextResponse.json({ error: "Ranked opens soon. Casual duels are on." }, { status: 409, headers: NO_STORE });
        throw err;
      }
    } else out = await searchMatch(body.settings, body.name, body.ticket ?? newTicket());
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const result =
      out.status === "waiting"
        ? { status: out.status, ticket: out.ticket, since: out.since, ...(out.botAfterMs ? { botAfterMs: out.botAfterMs } : {}) }
        : { status: out.status, code: out.code, token: out.token, href: out.href };
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("[duel-match]", err);
    return NextResponse.json({ error: "Matchmaking hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
