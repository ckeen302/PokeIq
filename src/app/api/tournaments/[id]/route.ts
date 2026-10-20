import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BATTLE_TEAM_MAX } from "@/lib/battle/play";
import { TOURNAMENT_ID_RE, hostAction, joinTournament, leaveTournament, viewTournament } from "@/lib/server/tournaments/service";
import { NO_STORE, result, tournamentAction, tournamentRequest } from "@/lib/server/tournaments/route";

/**
 * GET  /api/tournaments/:id: the tournament, brought up to date (finished
 *      battles applied, sign-ups closed on time, new matches started). A
 *      signed-in player also gets their match waiting to be played, with
 *      their seat token (nobody else's).
 * POST /api/tournaments/:id:
 *   { action: "join", team? }    sign up (bring-your-own formats need a team)
 *   { action: "leave" }          drop out during sign-ups
 *   { action: "start" }          the host closes sign-ups early
 *   { action: "cancel" }         the host cancels
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), team: z.string().max(BATTLE_TEAM_MAX).optional() }),
  z.object({ action: z.literal("leave") }),
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("cancel") }),
]);

type Context = { params: Promise<{ id: string }> };

async function idFrom(context: Context) {
  const { id } = await context.params;
  return TOURNAMENT_ID_RE.test(id) ? id : null;
}

export async function GET(request: NextRequest, context: Context) {
  const ctx = await tournamentRequest(request, "tour-view", { perMinute: 90, signedIn: false });
  if (ctx instanceof NextResponse) return ctx;
  const id = await idFrom(context);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  return tournamentAction(async () => {
    const view = await viewTournament(id, ctx.user);
    if (!view) return NextResponse.json({ error: "That tournament doesn't exist." }, { status: 404, headers: NO_STORE });
    return NextResponse.json(view, { headers: NO_STORE });
  });
}

export async function POST(request: NextRequest, context: Context) {
  const ctx = await tournamentRequest(request, "tour-act", { perMinute: 30 });
  if (ctx instanceof NextResponse) return ctx;
  const user = ctx.user!;
  const id = await idFrom(context);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;
  return tournamentAction(async () => {
    if (body.action === "join") return result(await joinTournament(id, user, body.team));
    if (body.action === "leave") return result(await leaveTournament(id, user));
    return result(await hostAction(id, user, body.action));
  });
}
