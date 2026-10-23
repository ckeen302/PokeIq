import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema, pvpToken, readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import { duelsEnabled } from "@/lib/server/duel-store";
import { guessParty, joinParty, leaveParty, partyStore, partyView, readyParty, startParty, touchParty } from "@/lib/server/connections-party";
import { CONN_GROUP_SIZE } from "@/lib/connections/types";
import { TILE_ID_MAX } from "@/lib/connections/tiles";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import type { PartySeatResponse } from "@/lib/connections/party";

/**
 * GET  /api/connections/party/:code — the party as you may see it (header
 *      x-duel-token: your player token; without one you're a visitor). Clients
 *      poll this; it also tells the server you're still here.
 * POST /api/connections/party/:code — an action:
 *   { action: "join", name }               take a seat (returns your token)
 *   { action: "ready", token, ready }      in the lobby
 *   { action: "start", token }             the host starts the race (everyone else ready, two or more players)
 *   { action: "group", token, tiles }      four tile numbers that belong together
 *   { action: "leave", token }             leave the lobby, or drop out of the race
 */

const NO_STORE = { "Cache-Control": "no-store" };
const token = z.string().min(10).max(512);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: duelNameSchema }),
  z.object({ action: z.literal("ready"), token, ready: z.boolean() }),
  z.object({ action: z.literal("start"), token }),
  z.object({ action: z.literal("group"), token, tiles: z.array(z.number().int().positive().max(TILE_ID_MAX)).length(CONN_GROUP_SIZE) }),
  z.object({ action: z.literal("leave"), token }),
]);

type Context = { params: Promise<{ code: string }> };

const failure = (out: PvpFailure) => NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });

function storeError(err: unknown) {
  console.error("[party]", err);
  return NextResponse.json({ error: "The party server hiccupped. Try again." }, { status: 503, headers: NO_STORE });
}

async function codeFrom(context: Context): Promise<string | null> {
  const { code } = await context.params;
  return DUEL_CODE_RE.test(code) ? code : null;
}

export async function GET(request: NextRequest, context: Context) {
  // Up to eight players poll about once a second, often from one address.
  if (!rateLimit(`conn-party:${clientIp(request)}`, 40, 6)) return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const playerId = readPvpToken(request.headers.get("x-duel-token"), code);
  try {
    const out = await partyStore.update(code, (party, now) => ({ ok: true as const, duel: touchParty(party, playerId, now) }));
    if (!out.ok) return failure(out);
    return NextResponse.json(partyView(out.duel, playerId, out.now, out.rev), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!rateLimit(`conn-party-act:${clientIp(request)}`, 40, 3)) return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  if (!duelsEnabled()) return NextResponse.json({ error: "Parties aren't enabled on this server yet." }, { status: 503 });
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (body.action === "join") {
    const blocked = await gate(request, "play");
    if (blocked) return blocked;
  }

  try {
    if (body.action === "join") {
      const out = await partyStore.update(code, (party, now) => {
        const joined = joinParty(party, body.name, now);
        return joined.ok ? { ok: true as const, duel: joined.party, playerId: joined.playerId } : joined;
      });
      if (!out.ok) return failure(out);
      const seat: PartySeatResponse = { code, token: pvpToken(code, out.playerId), view: partyView(out.duel, out.playerId, out.now, out.rev) };
      return NextResponse.json(seat, { headers: NO_STORE });
    }

    const playerId = readPvpToken(body.token, code);
    if (!playerId) return NextResponse.json({ error: "That isn't your seat in this party." }, { status: 403 });
    const out = await partyStore.update(code, (party, now) => {
      const res =
        body.action === "ready"
          ? readyParty(party, playerId, body.ready, now)
          : body.action === "start"
            ? startParty(party, playerId, now)
            : body.action === "group"
              ? guessParty(party, playerId, body.tiles, now)
              : leaveParty(party, playerId, now);
      return res.ok ? { ok: true as const, duel: res.party } : res;
    });
    if (!out.ok) return failure(out);
    return NextResponse.json(partyView(out.duel, playerId, out.now, out.rev), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}
