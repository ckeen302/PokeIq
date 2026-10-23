import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { checkGuess, gridView, ppFor } from "@/lib/server/pikadoku";
import { gridFields, guessSchema, historySchema, resolveGrid } from "@/lib/server/pikadoku-http";
import { pdkStartToken, pdkStore, pickPct } from "@/lib/server/pikadoku-board";
import { PDK_PP } from "@/lib/pikadoku/types";

/**
 * Pikadoku.
 *
 * GET /api/pikadoku?date=YYYY-MM-DD&difficulty=normal | ?practice=<seed>[&fam=..]
 *   The grid's six categories (never their answers) and, for a daily, a
 *   signed start token the server times the game from.
 *
 * POST /api/pikadoku { date | practice, difficulty, settings, guesses, next }
 *   Checks one new guess against the history so far: valid or not, a
 *   soft-lock refusal (Unlimited's guard), and the pick's rarity once locked.
 *   Stateless; the valid answers never leave the server here.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`pdk-get:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  const p = request.nextUrl.searchParams;
  const fam = p.get("fam");
  const found = resolveGrid({
    date: p.get("date") ?? undefined,
    difficulty: p.get("difficulty") ?? "normal",
    practice: p.get("practice") ?? undefined,
    settings: {
      unlimitedPP: p.get("pp") === "1",
      softLockGuard: p.get("guard") !== "0",
      allowSingle: p.get("single") === "1",
      timer: p.get("timer") === "1",
      families: fam ? fam.split(",") : undefined,
    } as never,
  });
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: 400, headers: NO_STORE });
  const body = { grid: gridView(found.grid), pp: ppFor(found.daily, found.settings) ?? 0, ...(found.daily && { start: pdkStartToken(found.key) }) };
  return NextResponse.json(body, { headers: NO_STORE });
}

const bodySchema = z.object({ ...gridFields, guesses: historySchema, next: guessSchema });

export async function POST(request: NextRequest) {
  if (!rateLimit(`pdk-guess:${clientIp(request)}`, 60, 1)) return tooManyRequests("Too many guesses — slow down a little.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const found = resolveGrid(parsed.data);
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: 400, headers: NO_STORE });
  const pp = found.daily ? PDK_PP : ppFor(false, found.settings);
  const out = checkGuess(found.grid, parsed.data.guesses, parsed.data.next, { pp, guard: !found.daily && found.settings.softLockGuard });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400, headers: NO_STORE });
  let pct: number | null = null;
  if (out.valid && !out.softlock && found.daily && parsed.data.date) {
    // The rarity so far, counting this pick in (the final score is recomputed from recorded answers).
    const counts = await pdkStore()
      ?.counts(parsed.data.date, parsed.data.difficulty as never)
      .catch(() => null);
    if (counts) {
      const { cell, id } = parsed.data.next;
      pct = pickPct({ totals: counts.totals.map((t, i) => t + (i === cell ? 1 : 0)), picks: counts.picks.map((m, i) => (i === cell ? new Map(m).set(id, (m.get(id) ?? 0) + 1) : m)) }, cell, id);
    }
  }
  return NextResponse.json({ valid: out.valid, ...(out.softlock && { softlock: true }), pct }, { headers: NO_STORE });
}
