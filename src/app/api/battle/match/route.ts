import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel-core";
import { newTicket } from "@/lib/server/match-queue";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { cancelBattleSearch, searchBattle } from "@/lib/server/battle-engine/matchmaking";
import { BATTLE_TEAM_MAX, PLAY_FORMATS } from "@/lib/battle/play";

/**
 * POST /api/battle/match — find an opponent for a live battle:
 *   { action: "search", settings: { format }, name, team?, ticket? }
 *        search, or poll a search (about once a second; polling keeps it
 *        alive). `team` (Showdown export text) is required in formats
 *        without random teams, and is checked before the search joins the
 *        queue. Returns { status: "waiting", ticket, since } or, once paired,
 *        { status: "matched", code, token, href }: the battle has started.
 *   { action: "cancel", settings: { format }, ticket }   give up the search
 */

// Pairing starts the battle, so the simulator runs here (unbundled, see next.config.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const ticket = z.string().regex(/^[\w-]{16}$/, "Bad ticket.");
// Matchmaking keeps to the standard formats, plus the Battle Factory (both trainers rent teams).
const settings = z.object({ format: z.enum([...PLAY_FORMATS, "factory"]) });

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), settings, name: duelNameSchema, team: z.string().max(BATTLE_TEAM_MAX).optional(), ticket: ticket.optional() }),
  z.object({ action: z.literal("cancel"), settings, ticket }),
]);

export async function POST(request: NextRequest) {
  // A searching trainer polls about once a second.
  if (!rateLimit(`battle-match:${clientIp(request)}`, 30, 3)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429, headers: NO_STORE });
  }
  if (!battlesEnabled()) {
    return NextResponse.json({ error: "Battles aren't enabled on this server yet." }, { status: 503, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;

  try {
    if (body.action === "cancel") {
      await cancelBattleSearch(body.settings.format, body.ticket);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    const out = await searchBattle(body.settings.format, body.name, body.ticket ?? newTicket(), body.team);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const result =
      out.status === "waiting"
        ? { status: out.status, ticket: out.ticket, since: out.since }
        : { status: out.status, code: out.code, token: out.token, href: out.href };
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("[battle-match]", err);
    return NextResponse.json({ error: "Matchmaking hiccupped. Try again." }, { status: 503, headers: NO_STORE });
  }
}
