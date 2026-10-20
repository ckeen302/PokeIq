import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chatRateLimit, clientIp, rateLimit } from "@/lib/server/rate-limit";
import { CHAT_BODY_MAX } from "@/lib/server/chat";
import { duelNameSchema, type PvpFailure } from "@/lib/server/duel-core";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { actOnBattle, battleToken, chatBattle, pollBattle, readBattleToken, rematchBattle } from "@/lib/server/battle-engine/service";
import { needsSettling, saveReplayFor, settleBattle } from "@/lib/server/battle-engine/settle";
import { battlePlayerKey } from "@/lib/server/battle-engine/identity";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { BATTLE_CHOICE_RE, BATTLE_TEAM_MAX, type BattleSeatResponse } from "@/lib/battle/play";

/**
 * GET  /api/battle/:code?since=N: the battle as you may see it (header
 *      x-battle-token: your seat token; without one you're a visitor), with
 *      your channel's protocol lines from N on. Clients poll this; it also
 *      tells the server you're still here, and catches up clocks and
 *      disconnects.
 * POST /api/battle/:code: an action:
 *   { action: "join", name, team?, rankedId? }    take the free seat in a live battle (returns your token)
 *   { action: "savereplay", token }               after the end: save the battle's replay (spectator log only)
 *   { action: "ready", token, ready }             in the lobby; the battle starts when both are ready
 *   { action: "team", token, team }               in the lobby: bring (or replace) your team
 *   { action: "choose", token, rqid, choice }     answer request `rqid` ("move 1", "switch 3", "team 213456"...)
 *   { action: "forfeit", token }                  leave the lobby, or forfeit the battle
 *   { action: "timer", token }                    start the turn timer (a live battle that began with it off)
 *   { action: "rematch", token }                  a new live battle with the same players
 *   { action: "chat", token, text }               live battles: a chat message (see server/chat.ts)
 * Every action takes `since` too, and answers with your view from there.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const token = z.string().min(10).max(512);
const since = z.number().int().min(0).max(1_000_000).default(0);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: duelNameSchema, team: z.string().max(BATTLE_TEAM_MAX).optional(), rankedId: z.string().max(200).optional() }),
  z.object({ action: z.literal("savereplay"), token, since }),
  z.object({ action: z.literal("ready"), token, ready: z.boolean(), since }),
  z.object({ action: z.literal("team"), token, team: z.string().min(1).max(BATTLE_TEAM_MAX), since }),
  z.object({
    action: z.literal("choose"),
    token,
    rqid: z.number().int().min(0).max(1_000_000),
    choice: z.string().trim().toLowerCase().regex(BATTLE_CHOICE_RE, "That isn't a valid choice."),
    since,
  }),
  z.object({ action: z.literal("forfeit"), token, since }),
  z.object({ action: z.literal("timer"), token, since }),
  z.object({ action: z.literal("rematch"), token }),
  z.object({ action: z.literal("chat"), token, text: z.string().max(CHAT_BODY_MAX, "Keep it under 200 characters."), since }),
]);

type Context = { params: Promise<{ code: string }> };

const failure = (out: PvpFailure) => NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });

function storeError(err: unknown) {
  console.error("[battle]", err);
  return NextResponse.json({ error: "The battle server hiccupped. Try again." }, { status: 503, headers: NO_STORE });
}

async function codeFrom(context: Context): Promise<string | null> {
  const { code } = await context.params;
  return DUEL_CODE_RE.test(code) ? code : null;
}

export async function GET(request: NextRequest, context: Context) {
  // Two players poll about once a second, often from one address.
  if (!rateLimit(`battle:${clientIp(request)}`, 40, 6)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429, headers: NO_STORE });
  }
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const raw = Number(request.nextUrl.searchParams.get("since") ?? 0);
  const from = Number.isInteger(raw) && raw >= 0 ? raw : 0;
  try {
    const poll = () => pollBattle(code, request.headers.get("x-battle-token"), from, request.headers.get("x-battle-viewer"));
    let out = await poll();
    if (!out.ok) return failure(out);
    // Just over: record it (replay, ratings, history) once, then answer with the settled battle.
    if (needsSettling(out.view)) {
      try {
        await settleBattle(code);
        const settled = await poll();
        if (settled.ok) out = settled;
      } catch (err) {
        console.error("[battle] settling failed:", err);
      }
    }
    return NextResponse.json(out.view, { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!rateLimit(`battle-act:${clientIp(request)}`, 40, 3)) {
    return NextResponse.json({ error: "Slow down, trainer." }, { status: 429, headers: NO_STORE });
  }
  if (!battlesEnabled()) {
    return NextResponse.json({ error: "Battles aren't enabled on this server yet." }, { status: 503, headers: NO_STORE });
  }
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;

  try {
    if (body.action === "join") {
      const player = await battlePlayerKey(request, body.rankedId);
      const out = await actOnBattle(code, null, { action: "join", name: body.name, team: body.team, player: player ?? undefined }, 0);
      if (!out.ok) return failure(out);
      const seat: BattleSeatResponse = { code, token: battleToken(code, out.playerId, out.view.you ?? 1), view: out.view };
      return NextResponse.json(seat, { headers: NO_STORE });
    }

    const seat = readBattleToken(body.token, code);
    if (!seat) return NextResponse.json({ error: "That isn't your seat in this battle." }, { status: 403, headers: NO_STORE });

    if (body.action === "rematch") {
      const out = await rematchBattle(code, seat.playerId);
      if (!out.ok) return failure(out);
      const next: BattleSeatResponse = { code: out.code, token: out.token, view: out.view };
      return NextResponse.json(next, { headers: NO_STORE });
    }

    if (body.action === "savereplay") {
      const saved = await saveReplayFor(code, seat.playerId);
      if (!saved.ok) return failure(saved);
      const out = await pollBattle(code, body.token, body.since);
      if (!out.ok) return failure(out);
      return NextResponse.json(out.view, { headers: NO_STORE });
    }

    if (body.action === "chat") {
      const limited = chatRateLimit(clientIp(request), seat.playerId);
      if (limited) return limited;
      const out = await chatBattle(code, seat.playerId, body.text, body.since);
      if (!out.ok) return failure(out);
      return NextResponse.json(out.view, { headers: NO_STORE });
    }

    const out = await actOnBattle(code, seat.playerId, body, body.since);
    if (!out.ok) return failure(out);
    // An illegal choice: the simulator's reason, with the (possibly updated) request to answer instead.
    if (out.rejected) return NextResponse.json({ error: out.rejected, view: out.view }, { status: 422, headers: NO_STORE });
    return NextResponse.json(out.view, { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}
