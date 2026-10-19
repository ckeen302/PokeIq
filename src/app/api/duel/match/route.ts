import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel-core";
import { duelsEnabled } from "@/lib/server/duel-store";
import { cancelMatch, matchSettingsSchema, newTicket, searchMatch } from "@/lib/server/matchmaking";

/**
 * POST /api/duel/match — find an opponent (PokéGuessr on a map, or Pokédle):
 *   { action: "search", settings, name, ticket? }   search, or poll a search (about once a second;
 *                                                   polling keeps it alive). Returns
 *                                                   { status: "waiting", ticket, since } or, once
 *                                                   paired, { status: "matched", code, token, href }
 *   { action: "cancel", settings, ticket }          give up the search
 * settings: { game: "geo", region } or { game: "pokedle" }.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const ticket = z.string().regex(/^[\w-]{16}$/, "Bad ticket.");

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), settings: matchSettingsSchema, name: duelNameSchema, ticket: ticket.optional() }),
  z.object({ action: z.literal("cancel"), settings: matchSettingsSchema, ticket }),
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

  try {
    if (body.action === "cancel") {
      await cancelMatch(body.settings, body.ticket);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    const out = await searchMatch(body.settings, body.name, body.ticket ?? newTicket());
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const result =
      out.status === "waiting"
        ? { status: out.status, ticket: out.ticket, since: out.since }
        : { status: out.status, code: out.code, token: out.token, href: out.href };
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("[duel-match]", err);
    return NextResponse.json({ error: "Matchmaking hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
