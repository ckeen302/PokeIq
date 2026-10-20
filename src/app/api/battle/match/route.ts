import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel-core";
import { newTicket } from "@/lib/server/match-queue";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { cancelBattleSearch, searchBattle, searchRankedBattle } from "@/lib/server/battle-engine/matchmaking";
import { hideBattle, readBattleToken } from "@/lib/server/battle-engine/service";
import { battlePlayerKey } from "@/lib/server/battle-engine/identity";
import { ladderStore } from "@/lib/server/battle-engine/ladder";
import { RankedUnavailable } from "@/lib/server/ranked";
import { RANKED_START } from "@/lib/ranked";
import { isLadderFormat } from "@/lib/battle/ladder";
import { ALL_FORMATS, BATTLE_TEAM_MAX, type StandardFormatId } from "@/lib/battle/play";

/**
 * POST /api/battle/match — find an opponent for a live battle:
 *   { action: "search", settings: { format, ranked? }, name, team?, ticket?, rankedId? }
 *        search, or poll a search (about once a second; polling keeps it
 *        alive). `team` (Showdown export text) is required in formats
 *        without random teams, and is checked before the search joins the
 *        queue. Returns { status: "waiting", ticket, since } or, once paired,
 *        { status: "matched", code, token, href }: the battle has started.
 *   { action: "cancel", settings: { format, ranked? }, ticket }   give up the search
 *
 * `settings.ranked`: the format's ranked queue (ladder formats only), paired
 * by rating. Every search sends `rankedId` (the signed id /api/battle/id gave
 * this browser) unless signed in: it's who the rating, record and replays
 * belong to.
 */

// Pairing starts the battle, so the simulator runs here (unbundled, see next.config.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const ticket = z.string().regex(/^[\w-]{16}$/, "Bad ticket.");
// Matchmaking keeps to the standard formats, plus the Battle Factory (both trainers rent teams).
const settings = z.object({ format: z.enum(["factory", ...ALL_FORMATS] as [StandardFormatId | "factory", ...(StandardFormatId | "factory")[]]), ranked: z.boolean().default(false) });

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    settings,
    name: duelNameSchema,
    team: z.string().max(BATTLE_TEAM_MAX).optional(),
    ticket: ticket.optional(),
    rankedId: z.string().max(200).optional(),
    /** "Don't allow spectators": the battle is hidden as soon as this trainer collects it. */
    hidden: z.boolean().optional(),
  }),
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
  if (body.action === "search") {
    const blocked = await gate(request, "play");
    if (blocked) return blocked;
  }

  try {
    if (body.action === "cancel") {
      await cancelBattleSearch(body.settings.format, body.ticket, body.settings.ranked);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    const player = (await battlePlayerKey(request, body.rankedId)) ?? undefined;
    let out: Awaited<ReturnType<typeof searchBattle>>;
    const format = body.settings.format;
    if (body.settings.ranked) {
      if (!isLadderFormat(format)) return NextResponse.json({ error: "There's no ladder for that format." }, { status: 400, headers: NO_STORE });
      const store = ladderStore();
      if (!store) return NextResponse.json({ error: "Ranked battles aren't open on this server yet." }, { status: 503, headers: NO_STORE });
      if (!player) return NextResponse.json({ error: "Reload the page to get your ranked card." }, { status: 400, headers: NO_STORE });
      try {
        out = await searchRankedBattle(format, body.name, body.ticket ?? newTicket(), player, async () => (await store.rating(player, format)) ?? { rating: RANKED_START, games: 0 }, body.team);
      } catch (err) {
        if (err instanceof RankedUnavailable) return NextResponse.json({ error: "Ranked battles open soon. Casual battles are on." }, { status: 409, headers: NO_STORE });
        throw err;
      }
    } else out = await searchBattle(format, body.name, body.ticket ?? newTicket(), body.team, player);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    if (out.status === "matched" && body.hidden) {
      const seat = readBattleToken(out.token, out.code);
      if (seat) await hideBattle(out.code, seat.playerId).catch((err) => console.error("[battle-match] hide failed:", err));
    }
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
