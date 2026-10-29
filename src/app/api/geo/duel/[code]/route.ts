import { NextRequest, NextResponse } from "next/server";
import { seatAvatars } from "@/lib/server/avatars";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { syncHiddenShots } from "@/lib/server/geo-reports";
import { chatRateLimit, clientIp, rateLimit } from "@/lib/server/rate-limit";
import { CHAT_BODY_MAX } from "@/lib/server/chat";
import { ALL_DUEL_EMOTES } from "@/lib/pvp-types";
import {
  chatDuel,
  duelNameSchema,
  emoteDuel,
  duelToken,
  duelView,
  guessDuel,
  joinDuel,
  leaveDuel,
  linkRematch,
  readDuelToken,
  readyDuel,
  rematchOf,
  skipReveal,
  takeRematchSeat,
  touchDuel,
  type DuelFailure,
} from "@/lib/server/duel";
import { deleteDuel, duelsEnabled, insertDuel, loadDuel, newDuelCode, updateDuel } from "@/lib/server/duel-store";
import { settleGeoRankedDuel } from "@/lib/server/geo-ranked-duels";
import { publishIfChanged } from "@/lib/server/geo-duel-live";
import { logFinishedDuel, stampStatsKey } from "@/lib/server/geo-duel-stats";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { realtimeClientConfig } from "@/lib/server/realtime";
import type { Duel } from "@/lib/server/duel";
import { DUEL_CODE_RE, DUEL_MAX_ROUNDS, type DuelSeatResponse, type DuelView } from "@/lib/duel-types";

/**
 * GET  /api/geo/duel/:code — the duel as you may see it (header x-duel-token:
 *      your player token; without one you're a visitor). Clients poll this; it
 *      also tells the server you're still here. `live` says where to subscribe
 *      for pushes instead (null: not set up here, so pages poll every second).
 *
 * Every write that changes what a page shows is published on the duel's
 * channel (server/geo-duel-live.ts), so the other trainer's page fetches at
 * once rather than at its next poll.
 * POST /api/geo/duel/:code — an action:
 *   { action: "join", name }                  take the free seat (returns your token)
 *   { action: "ready", token, ready }         in the lobby; the duel starts when both are ready
 *   { action: "guess", token, round, x, y }   lock in a pin (x, y normalised 0–1 on the map)
 *   { action: "next", token, round }          end the reveal early (once both press it)
 *   { action: "leave", token }                leave the lobby, or forfeit
 *   { action: "rematch", token }              a new duel with the same map and trainers
 *   { action: "emote", token, emote }         a preset reaction, during play or after the end
 *   { action: "chat", token, text }           a chat message, in the lobby or after the end (see server/chat.ts)
 */

const NO_STORE = { "Cache-Control": "no-store" };
const token = z.string().min(10).max(512);
const round = z.number().int().min(0).max(DUEL_MAX_ROUNDS);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: duelNameSchema }),
  z.object({ action: z.literal("ready"), token, ready: z.boolean() }),
  z.object({ action: z.literal("guess"), token, round, x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.object({ action: z.literal("next"), token, round }),
  z.object({ action: z.literal("leave"), token }),
  z.object({ action: z.literal("rematch"), token }),
  z.object({ action: z.literal("emote"), token, emote: z.enum(ALL_DUEL_EMOTES) }),
  z.object({ action: z.literal("chat"), token, text: z.string().max(CHAT_BODY_MAX, "Keep it under 200 characters.") }),
]);

type Context = { params: Promise<{ code: string }> };

const failure = (out: DuelFailure) => NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });

/** The view as the page gets it, with where to subscribe for pushes. */
async function viewOf(duel: Duel, playerId: string | null, now: number, rev: number): Promise<DuelView> {
  return { ...(await seatAvatars(duelView(duel, playerId, now, rev))), live: realtimeClientConfig() };
}

function storeError(err: unknown) {
  console.error("[geo-duel]", err);
  return NextResponse.json({ error: "The duel server hiccupped. Try again." }, { status: 503, headers: NO_STORE });
}

async function codeFrom(context: Context): Promise<string | null> {
  const { code } = await context.params;
  return DUEL_CODE_RE.test(code) ? code : null;
}

export async function GET(request: NextRequest, context: Context) {
  // Two trainers poll about once a second, often from one address.
  if (!rateLimit(`geo-duel:${clientIp(request)}`, 40, 6)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  }
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // New rounds are dealt as the duel moves on: not from shots players have since flagged.
  await syncHiddenShots();
  const playerId = readDuelToken(request.headers.get("x-duel-token"), code);
  try {
    let before: Duel | undefined;
    const out = await updateDuel(code, (duel, now) => {
      before = duel;
      return { ok: true as const, duel: touchDuel(duel, playerId, now) };
    });
    if (!out.ok) return failure(out);
    // A poll that moved the duel on (a round's clock ran out, the next one started): tell the other page.
    publishIfChanged(code, before, out.duel, out.rev);
    void logFinishedDuel(before, out.duel);
    // A ranked duel that just ended: count it (once), so the view carries the rating change.
    const settled = await settleGeoRankedDuel(out.duel, out.rev);
    return NextResponse.json(await viewOf(settled.duel, playerId, out.now, settled.rev), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!rateLimit(`geo-duel-act:${clientIp(request)}`, 30, 2)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  }
  if (!duelsEnabled()) {
    return NextResponse.json({ error: "Duels aren't enabled on this server yet." }, { status: 503 });
  }
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // New rounds are dealt as the duel moves on: not from shots players have since flagged.
  await syncHiddenShots();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (body.action === "chat" || body.action === "join" || body.action === "rematch") {
    const blocked = await gate(request, body.action === "chat" ? "chat" : "play");
    if (blocked) return blocked;
  }

  try {
    if (body.action === "join") {
      let before: Duel | undefined;
      const out = await updateDuel(code, (duel, now) => {
        before = duel;
        return joinDuel(duel, body.name, now);
      });
      if (!out.ok) return failure(out);
      publishIfChanged(code, before, out.duel, out.rev);
      const seat: DuelSeatResponse = { code, token: duelToken(code, out.playerId), view: await viewOf(out.duel, out.playerId, out.now, out.rev) };
      return NextResponse.json(seat, { headers: NO_STORE });
    }

    const playerId = readDuelToken(body.token, code);
    if (!playerId) return NextResponse.json({ error: "That isn't your seat in this duel." }, { status: 403 });
    if (body.action === "rematch") return await rematch(code, playerId);
    // Reactions and chat have their own, tighter limits (the duel also allows only a few at a time per trainer).
    if (body.action === "emote" && !rateLimit(`duel-emote:${clientIp(request)}`, 6, 0.5)) {
      return NextResponse.json({ error: "Easy on the reactions." }, { status: 429, headers: NO_STORE });
    }
    if (body.action === "chat") {
      const limited = chatRateLimit(clientIp(request), playerId);
      if (limited) return limited;
    }

    // A signed-in trainer playing under their own name: their rounds go on their PokéGuessr record when the duel ends.
    const account = (body.action === "guess" || body.action === "ready") && sessionTokenHash(request) ? await userFromRequest(request).catch(() => null) : null;
    const act = (duel: Duel, now: number) => {
      switch (body.action) {
        case "ready":
          return readyDuel(duel, playerId, body.ready, now);
        case "guess":
          return guessDuel(duel, playerId, body.round, { x: body.x, y: body.y }, now);
        case "next":
          return skipReveal(duel, playerId, body.round, now);
        case "leave":
          return leaveDuel(duel, playerId, now);
        case "emote":
          return emoteDuel(duel, playerId, body.emote, now);
        case "chat":
          return chatDuel(duel, playerId, body.text, now);
      }
    };
    let before: Duel | undefined;
    const out = await updateDuel(code, (duel, now) => {
      before = duel;
      const acted = act(duel, now);
      return acted.ok ? { ...acted, duel: stampStatsKey(acted.duel, playerId, account) } : acted;
    });
    if (!out.ok) return failure(out);
    publishIfChanged(code, before, out.duel, out.rev);
    void logFinishedDuel(before, out.duel);
    const settled = await settleGeoRankedDuel(out.duel, out.rev);
    return NextResponse.json(await viewOf(settled.duel, playerId, out.now, settled.rev), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

/**
 * The first trainer to ask opens the rematch and links it from the finished
 * duel; the other one's request finds the link. Either way the asker takes
 * their seat in it, ready.
 */
async function rematch(code: string, playerId: string) {
  const stored = await loadDuel(code);
  if (!stored) return NextResponse.json({ error: "This duel has ended or never existed." }, { status: 404 });
  const me = stored.duel.players.find((p) => p.id === playerId);
  if (!me) return NextResponse.json({ error: "You're not in this duel." }, { status: 403 });
  if (stored.duel.status !== "finished") return NextResponse.json({ error: "The duel isn't over yet." }, { status: 409 });

  let next = stored.duel.rematch;
  if (!next) {
    let opened: string | null = null;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      const fresh = rematchOf(stored.duel, newDuelCode(), Date.now());
      if (await insertDuel(fresh)) opened = fresh.code;
    }
    if (!opened) return NextResponse.json({ error: "Couldn't open a rematch. Try again." }, { status: 503 });
    let before: Duel | undefined;
    const linked = await updateDuel(code, (duel) => {
      before = duel;
      return linkRematch(duel, opened);
    });
    if (!linked.ok) return failure(linked);
    // The other trainer's end screen says "Rematch requested!" at once.
    publishIfChanged(code, before, linked.duel, linked.rev);
    next = linked.duel.rematch!;
    // Both asked at once and the other request linked its rematch first.
    if (next !== opened) await deleteDuel(opened);
  }

  let seated: Duel | undefined;
  const out = await updateDuel(next, (duel, now) => {
    seated = duel;
    return takeRematchSeat(duel, playerId, me.name, now);
  });
  if (!out.ok) return failure(out);
  publishIfChanged(next, seated, out.duel, out.rev);
  const seat: DuelSeatResponse = { code: next, token: duelToken(next, playerId), view: await viewOf(out.duel, playerId, out.now, out.rev) };
  return NextResponse.json(seat, { headers: NO_STORE });
}
