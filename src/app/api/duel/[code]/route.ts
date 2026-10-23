import { NextRequest, NextResponse } from "next/server";
import { seatAvatars } from "@/lib/server/avatars";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { chatRateLimit, clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema, pvpToken, readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import { duelsEnabled, newDuelCode, pvpStore } from "@/lib/server/duel-store";
import { settleRankedDuel } from "@/lib/server/ranked-duels";
import { CHAT_BODY_MAX } from "@/lib/server/chat";
import { asKind, chatDuel, duelView, emoteDuel, joinDuel, leaveDuel, linkRematch, readyDuel, rematchOf, skipReveal, takeRematchSeat, touchDuel } from "@/lib/server/duels";
import { buyPokedleHint, guessPokedle, setPokedleAssist, setPokedleGens, setPokedleSettings } from "@/lib/server/pokedle-duel";
import { DLE_ASSISTS } from "@/lib/dle-assist";
import { answerQuiz } from "@/lib/server/quiz-duel";
import { guessConnections } from "@/lib/server/connections-duel";
import { claimCell } from "@/lib/server/pikadoku-duel";
import { CONN_GROUP_SIZE } from "@/lib/connections/types";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { DLE_DUEL_HINTS, DUEL_EMOTES, QUIZ_DUEL_QUESTIONS, type PvpSeatResponse } from "@/lib/pvp-types";

/**
 * GET  /api/duel/:code — the duel as you may see it (header x-duel-token:
 *      your player token; without one you're a visitor). Clients poll this; it
 *      also tells the server you're still here.
 * POST /api/duel/:code — an action:
 *   { action: "join", name }                      take the free seat (returns your token)
 *   { action: "ready", token, ready }             in the lobby; the duel starts when both are ready
 *   { action: "gens", token, gens }               Pokédle, in the lobby: the creator picks the generations
 *   { action: "assist", token, assist }           Pokédle, in the lobby: the creator picks the Pokédex assist level
 *   { action: "settings", token, settings }       Pokédle, in the lobby: the creator picks the format and settings (dle-format DleSettings)
 *   { action: "guess", token, round, pokemon }    Pokédle: guess a Pokémon (by id)
 *   { action: "hint", token, round, hint }        Pokédle: buy a hint ("genus" or "silhouette")
 *   { action: "answer", token, round, choice }    quiz: lock in an answer to question `round`
 *   { action: "group", token, pokemon }           PokéConnections: four Pokémon ids that belong together
 *   { action: "claim", token, cell, pokemon }     Pikadoku: a Pokémon for a cell (a miss passes the turn)
 *   { action: "next", token, round }              end the reveal early (once both press it)
 *   { action: "leave", token }                    leave the lobby, or forfeit
 *   { action: "emote", token, emote }             a preset reaction ("gg", "fire", "wow", "sweat", "clap")
 *   { action: "rematch", token }                  a new duel with the same game and trainers
 *   { action: "chat", token, text }               a chat message, in the lobby or after the end (see server/chat.ts)
 */

const NO_STORE = { "Cache-Control": "no-store" };
const token = z.string().min(10).max(512);
/** A Pokédle round or a quiz question. */
const round = z.number().int().min(0).max(QUIZ_DUEL_QUESTIONS);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: duelNameSchema }),
  z.object({ action: z.literal("ready"), token, ready: z.boolean() }),
  z.object({ action: z.literal("gens"), token, gens: z.array(z.number().int().min(1).max(9)).max(9) }),
  z.object({ action: z.literal("assist"), token, assist: z.enum(DLE_ASSISTS) }),
  z.object({ action: z.literal("settings"), token, settings: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("guess"), token, round, pokemon: z.number().int().positive().max(100_000) }),
  z.object({ action: z.literal("hint"), token, round, hint: z.enum(DLE_DUEL_HINTS) }),
  z.object({ action: z.literal("answer"), token, round, choice: z.string().min(1).max(200) }),
  z.object({ action: z.literal("claim"), token, cell: z.number().int().min(0).max(8), pokemon: z.number().int().positive().max(100_000) }),
  z.object({ action: z.literal("group"), token, pokemon: z.array(z.number().int().positive().max(100_000)).length(CONN_GROUP_SIZE) }),
  z.object({ action: z.literal("next"), token, round }),
  z.object({ action: z.literal("leave"), token }),
  z.object({ action: z.literal("emote"), token, emote: z.enum(DUEL_EMOTES) }),
  z.object({ action: z.literal("rematch"), token }),
  z.object({ action: z.literal("chat"), token, text: z.string().max(CHAT_BODY_MAX, "Keep it under 200 characters.") }),
]);

type Context = { params: Promise<{ code: string }> };

const failure = (out: PvpFailure) => NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });

function storeError(err: unknown) {
  console.error("[duel]", err);
  return NextResponse.json({ error: "The duel server hiccupped. Try again." }, { status: 503, headers: NO_STORE });
}

async function codeFrom(context: Context): Promise<string | null> {
  const { code } = await context.params;
  return DUEL_CODE_RE.test(code) ? code : null;
}

export async function GET(request: NextRequest, context: Context) {
  // Two trainers poll about once a second, often from one address.
  if (!rateLimit(`duel:${clientIp(request)}`, 40, 6)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  }
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const playerId = readPvpToken(request.headers.get("x-duel-token"), code);
  try {
    const out = await pvpStore.update(code, (duel, now) => ({ ok: true as const, duel: touchDuel(duel, playerId, now) }));
    if (!out.ok) return failure(out);
    // A ranked duel that just ended is counted here, on the next request.
    const { duel, rev } = await settleRankedDuel(out.duel, out.rev);
    return NextResponse.json(await seatAvatars(duelView(duel, playerId, out.now, rev)), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!rateLimit(`duel-act:${clientIp(request)}`, 40, 3)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  }
  if (!duelsEnabled()) {
    return NextResponse.json({ error: "Duels aren't enabled on this server yet." }, { status: 503 });
  }
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (body.action === "chat" || body.action === "join" || body.action === "rematch") {
    const blocked = await gate(request, body.action === "chat" ? "chat" : "play");
    if (blocked) return blocked;
  }

  try {
    if (body.action === "join") {
      const out = await pvpStore.update(code, (duel, now) => joinDuel(duel, body.name, now));
      if (!out.ok) return failure(out);
      const seat: PvpSeatResponse = { code, token: pvpToken(code, out.playerId), view: await seatAvatars(duelView(out.duel, out.playerId, out.now, out.rev)) };
      return NextResponse.json(seat, { headers: NO_STORE });
    }

    const playerId = readPvpToken(body.token, code);
    if (!playerId) return NextResponse.json({ error: "That isn't your seat in this duel." }, { status: 403 });
    if (body.action === "rematch") return await rematch(code, playerId);
    // Reactions have their own, tighter limit (the duel also allows only a few at a time per trainer).
    if (body.action === "emote" && !rateLimit(`duel-emote:${clientIp(request)}`, 6, 0.5)) {
      return NextResponse.json({ error: "Easy on the reactions." }, { status: 429, headers: NO_STORE });
    }
    if (body.action === "chat") {
      const limited = chatRateLimit(clientIp(request), playerId);
      if (limited) return limited;
    }

    const out = await pvpStore.update(code, (duel, now) => {
      switch (body.action) {
        case "ready":
          return readyDuel(duel, playerId, body.ready, now);
        case "gens":
          return asKind(duel, "pokedle", (d) => setPokedleGens(d, playerId, body.gens, now));
        case "assist":
          return asKind(duel, "pokedle", (d) => setPokedleAssist(d, playerId, body.assist, now));
        case "settings":
          return asKind(duel, "pokedle", (d) => setPokedleSettings(d, playerId, body.settings, now));
        case "guess":
          return asKind(duel, "pokedle", (d) => guessPokedle(d, playerId, body.round, body.pokemon, now));
        case "hint":
          return asKind(duel, "pokedle", (d) => buyPokedleHint(d, playerId, body.round, body.hint, now));
        case "answer":
          return asKind(duel, "quiz", (d) => answerQuiz(d, playerId, body.round, body.choice, now));
        case "claim":
          return asKind(duel, "pikadoku", (d) => claimCell(d, playerId, body.cell, body.pokemon, now));
        case "group":
          return asKind(duel, "connections", (d) => guessConnections(d, playerId, body.pokemon, now));
        case "next":
          return skipReveal(duel, playerId, body.round, now);
        case "leave":
          return leaveDuel(duel, playerId, now);
        case "emote":
          return emoteDuel(duel, playerId, body.emote, now);
        case "chat":
          return chatDuel(duel, playerId, body.text, now);
      }
    });
    if (!out.ok) return failure(out);
    const { duel, rev } = await settleRankedDuel(out.duel, out.rev);
    return NextResponse.json(await seatAvatars(duelView(duel, playerId, out.now, rev)), { headers: NO_STORE });
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
  const stored = await pvpStore.load(code);
  if (!stored) return NextResponse.json({ error: "This duel has ended or never existed." }, { status: 404 });
  const me = stored.duel.players.find((p) => p.id === playerId);
  if (!me) return NextResponse.json({ error: "You're not in this duel." }, { status: 403 });
  if (stored.duel.status !== "finished") return NextResponse.json({ error: "The duel isn't over yet." }, { status: 409 });

  let next = stored.duel.rematch;
  if (!next) {
    let opened: string | null = null;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      const fresh = rematchOf(stored.duel, newDuelCode(), Date.now());
      if (await pvpStore.insert(fresh)) opened = fresh.code;
    }
    if (!opened) return NextResponse.json({ error: "Couldn't open a rematch. Try again." }, { status: 503 });
    const linked = await pvpStore.update(code, (duel) => linkRematch(duel, opened));
    if (!linked.ok) return failure(linked);
    next = linked.duel.rematch!;
    // Both asked at once and the other request linked its rematch first.
    if (next !== opened) await pvpStore.remove(opened);
  }

  const out = await pvpStore.update(next, (duel, now) => takeRematchSeat(duel, playerId, me.name, now));
  if (!out.ok) return failure(out);
  const seat: PvpSeatResponse = { code: next, token: pvpToken(next, playerId), view: await seatAvatars(duelView(out.duel, playerId, out.now, out.rev)) };
  return NextResponse.json(seat, { headers: NO_STORE });
}
