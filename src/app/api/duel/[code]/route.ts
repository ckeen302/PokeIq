import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema, pvpToken, readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import { duelsEnabled, newDuelCode, pvpStore } from "@/lib/server/duel-store";
import { asKind, duelView, joinDuel, leaveDuel, linkRematch, readyDuel, rematchOf, skipReveal, takeRematchSeat, touchDuel } from "@/lib/server/duels";
import { buyPokedleHint, guessPokedle, setPokedleGens } from "@/lib/server/pokedle-duel";
import { answerQuiz } from "@/lib/server/quiz-duel";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { DLE_DUEL_HINTS, QUIZ_DUEL_QUESTIONS, type PvpSeatResponse } from "@/lib/pvp-types";

/**
 * GET  /api/duel/:code — the duel as you may see it (header x-duel-token:
 *      your player token; without one you're a visitor). Clients poll this; it
 *      also tells the server you're still here.
 * POST /api/duel/:code — an action:
 *   { action: "join", name }                      take the free seat (returns your token)
 *   { action: "ready", token, ready }             in the lobby; the duel starts when both are ready
 *   { action: "gens", token, gens }               Pokédle, in the lobby: the creator picks the generations
 *   { action: "guess", token, round, pokemon }    Pokédle: guess a Pokémon (by id)
 *   { action: "hint", token, round, hint }        Pokédle: buy a hint ("genus" or "silhouette")
 *   { action: "answer", token, round, choice }    quiz: lock in an answer to question `round`
 *   { action: "next", token, round }              end the reveal early (once both press it)
 *   { action: "leave", token }                    leave the lobby, or forfeit
 *   { action: "rematch", token }                  a new duel with the same game and trainers
 */

const NO_STORE = { "Cache-Control": "no-store" };
const token = z.string().min(10).max(512);
/** A Pokédle round or a quiz question. */
const round = z.number().int().min(0).max(QUIZ_DUEL_QUESTIONS);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: duelNameSchema }),
  z.object({ action: z.literal("ready"), token, ready: z.boolean() }),
  z.object({ action: z.literal("gens"), token, gens: z.array(z.number().int().min(1).max(9)).max(9) }),
  z.object({ action: z.literal("guess"), token, round, pokemon: z.number().int().positive().max(100_000) }),
  z.object({ action: z.literal("hint"), token, round, hint: z.enum(DLE_DUEL_HINTS) }),
  z.object({ action: z.literal("answer"), token, round, choice: z.string().min(1).max(200) }),
  z.object({ action: z.literal("next"), token, round }),
  z.object({ action: z.literal("leave"), token }),
  z.object({ action: z.literal("rematch"), token }),
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
    return NextResponse.json(duelView(out.duel, playerId, out.now, out.rev), { headers: NO_STORE });
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

  try {
    if (body.action === "join") {
      const out = await pvpStore.update(code, (duel, now) => joinDuel(duel, body.name, now));
      if (!out.ok) return failure(out);
      const seat: PvpSeatResponse = { code, token: pvpToken(code, out.playerId), view: duelView(out.duel, out.playerId, out.now, out.rev) };
      return NextResponse.json(seat, { headers: NO_STORE });
    }

    const playerId = readPvpToken(body.token, code);
    if (!playerId) return NextResponse.json({ error: "That isn't your seat in this duel." }, { status: 403 });
    if (body.action === "rematch") return await rematch(code, playerId);

    const out = await pvpStore.update(code, (duel, now) => {
      switch (body.action) {
        case "ready":
          return readyDuel(duel, playerId, body.ready, now);
        case "gens":
          return asKind(duel, "pokedle", (d) => setPokedleGens(d, playerId, body.gens, now));
        case "guess":
          return asKind(duel, "pokedle", (d) => guessPokedle(d, playerId, body.round, body.pokemon, now));
        case "hint":
          return asKind(duel, "pokedle", (d) => buyPokedleHint(d, playerId, body.round, body.hint, now));
        case "answer":
          return asKind(duel, "quiz", (d) => answerQuiz(d, playerId, body.round, body.choice, now));
        case "next":
          return skipReveal(duel, playerId, body.round, now);
        case "leave":
          return leaveDuel(duel, playerId, now);
      }
    });
    if (!out.ok) return failure(out);
    return NextResponse.json(duelView(out.duel, playerId, out.now, out.rev), { headers: NO_STORE });
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
  const seat: PvpSeatResponse = { code: next, token: pvpToken(next, playerId), view: duelView(out.duel, playerId, out.now, out.rev) };
  return NextResponse.json(seat, { headers: NO_STORE });
}
