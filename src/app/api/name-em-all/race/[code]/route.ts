import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema, pvpToken, readPvpToken, type PvpFailure } from "@/lib/server/duel-core";
import { duelsEnabled } from "@/lib/server/duel-store";
import { joinRace, leaveRace, nameInRace, raceStore, raceView, readyRace, startRace, touchRace } from "@/lib/server/name-em-all-race";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import type { NeaRaceSeatResponse } from "@/lib/name-em-all/race";

/**
 * GET  /api/name-em-all/race/:code — the race as you may see it (header
 *      x-duel-token: your seat; without one you're a visitor). Clients poll it.
 * POST /api/name-em-all/race/:code — an action:
 *   { action: "join", name }            take a seat (returns your token)
 *   { action: "ready", token, ready }   in the lobby
 *   { action: "start", token }          the host starts (two or more, everyone ready)
 *   { action: "name", token, slots }    slots you've named since the last report
 *   { action: "leave", token }
 */

const NO_STORE = { "Cache-Control": "no-store" };
const token = z.string().min(10).max(512);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), name: duelNameSchema }),
  z.object({ action: z.literal("ready"), token, ready: z.boolean() }),
  z.object({ action: z.literal("start"), token }),
  z.object({ action: z.literal("name"), token, slots: z.array(z.number().int().min(0).max(2000)).min(1).max(200) }),
  z.object({ action: z.literal("leave"), token }),
]);

type Context = { params: Promise<{ code: string }> };

const failure = (out: PvpFailure) => NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });

function storeError(err: unknown) {
  console.error("[name-em-all race]", err);
  return NextResponse.json({ error: "The race server hiccupped. Try again." }, { status: 503, headers: NO_STORE });
}

async function codeFrom(context: Context): Promise<string | null> {
  const { code } = await context.params;
  return DUEL_CODE_RE.test(code) ? code : null;
}

export async function GET(request: NextRequest, context: Context) {
  if (!rateLimit(`nea-race:${clientIp(request)}`, 40, 6)) return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const playerId = readPvpToken(request.headers.get("x-duel-token"), code);
  try {
    const out = await raceStore.update(code, (race, now) => ({ ok: true as const, duel: touchRace(race, playerId, now) }));
    if (!out.ok) return failure(out);
    return NextResponse.json(raceView(out.duel, playerId, out.now, out.rev), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}

export async function POST(request: NextRequest, context: Context) {
  // Names arrive in batches about once a second from up to eight racers, often on one network.
  if (!rateLimit(`nea-race-act:${clientIp(request)}`, 60, 8)) return NextResponse.json({ error: "Slow down, trainer." }, { status: 429 });
  if (!duelsEnabled()) return NextResponse.json({ error: "Races aren't enabled on this server yet." }, { status: 503 });
  const code = await codeFrom(context);
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;

  try {
    if (body.action === "join") {
      const blocked = await gate(request, "play");
      if (blocked) return blocked;
      const out = await raceStore.update(code, (race, now) => {
        const joined = joinRace(race, body.name, now);
        return joined.ok ? { ok: true as const, duel: joined.race, playerId: joined.playerId } : joined;
      });
      if (!out.ok) return failure(out);
      const seat: NeaRaceSeatResponse = { code, token: pvpToken(code, out.playerId), view: raceView(out.duel, out.playerId, out.now, out.rev) };
      return NextResponse.json(seat, { headers: NO_STORE });
    }

    const playerId = readPvpToken(body.token, code);
    if (!playerId) return NextResponse.json({ error: "That isn't your seat in this race." }, { status: 403 });
    const out = await raceStore.update(code, (race, now) => {
      const res =
        body.action === "ready"
          ? readyRace(race, playerId, body.ready, now)
          : body.action === "start"
            ? startRace(race, playerId, now)
            : body.action === "name"
              ? nameInRace(race, playerId, body.slots, now)
              : leaveRace(race, playerId, now);
      return res.ok ? { ok: true as const, duel: res.race } : res;
    });
    if (!out.ok) return failure(out);
    return NextResponse.json(raceView(out.duel, playerId, out.now, out.rev), { headers: NO_STORE });
  } catch (err) {
    return storeError(err);
  }
}
