import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { createTournament, listTournaments } from "@/lib/server/tournaments/service";
import { NO_STORE, result, tournamentAction, tournamentRequest } from "@/lib/server/tournaments/route";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { MAX_PLAYERS, MIN_PLAYERS, SIGNUP_MINUTES, TOURNAMENT_FORMATS, type TournamentFormat } from "@/lib/tournaments";

/**
 * GET  /api/tournaments: the lobby (open and running tournaments, and the
 *      latest finished), creating the official hourly one when it's due.
 * POST /api/tournaments { format, style, maxPlayers, signupMinutes, bestOf }:
 *      a signed-in trainer opens a tournament (one at a time).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({
  format: z.enum(TOURNAMENT_FORMATS as [TournamentFormat, ...TournamentFormat[]]),
  style: z.enum(["elim", "rr"]),
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS),
  signupMinutes: z.number().int().refine((m) => (SIGNUP_MINUTES as readonly number[]).includes(m), "Pick a sign-up time."),
  bestOf: z.union([z.literal(1), z.literal(3)]),
});

export async function GET(request: NextRequest) {
  const ctx = await tournamentRequest(request, "tour-list", { perMinute: 60, signedIn: false });
  if (ctx instanceof NextResponse) return ctx;
  return tournamentAction(async () => NextResponse.json({ available: true, ...(await listTournaments()) }, { headers: NO_STORE }));
}

export async function POST(request: NextRequest) {
  const ctx = await tournamentRequest(request, "tour-create", { perMinute: 20 });
  if (ctx instanceof NextResponse) return ctx;
  const user = ctx.user!;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const blocked = await gate(request, "play");
  if (blocked) return blocked;
  if (!rateLimit(`tour-create-user:${user.id}`, 3, 3 / 3600)) return tooManyRequests("You've opened a few tournaments already. Try again later.", 600);
  return tournamentAction(async () => {
    const out = await createTournament(user, parsed.data);
    return result(out, out.ok ? { id: out.id } : {});
  });
}
