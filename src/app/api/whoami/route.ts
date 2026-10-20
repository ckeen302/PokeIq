import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlayableDailyDate } from "@/lib/daily";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { MIN_POOL, normalizeSettings, openSolo, poolOf, sealSolo, soloAct, soloView, startSolo } from "@/lib/server/whoami";
import { whoamiQuestionSchema, whoamiSettingsSchema } from "@/lib/server/whoami-schema";

/**
 * POST /api/whoami — Who Am I? practice and the daily, one trainer against the clock:
 *   { action: "start", mode: "daily", date }                   today's (the same Pokémon for everyone)
 *   { action: "start", mode: "practice", settings? }           a random one from the pool
 *   { action: "ask", state, q }                                a question (pays its PP)
 *   { action: "guess", state, pokemon }                        a guess (wrong: a lockout)
 *   { action: "view", state }                                  the game now (once time is up, who it was)
 * Returns { state, view }. `state` is sealed (encrypted): the browser carries
 * it back with each move but can't read the secret inside.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const state = z.string().min(20).max(8_000);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), mode: z.enum(["daily", "practice"]), date: z.string().optional(), settings: whoamiSettingsSchema.optional() }),
  z.object({ action: z.literal("ask"), state, q: whoamiQuestionSchema }),
  z.object({ action: z.literal("guess"), state, pokemon: z.number().int().positive().max(100_000) }),
  z.object({ action: z.literal("view"), state }),
]);

const bad = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function POST(request: NextRequest) {
  if (!rateLimit(`whoami:${clientIp(request)}`, 60, 3)) return bad(429, "Slow down, trainer.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return bad(400, parsed.error.issues[0].message);
  const body = parsed.data;
  const now = Date.now();

  if (body.action === "start") {
    if (body.mode === "daily" && !isPlayableDailyDate(body.date)) return bad(400, "That daily isn't available.");
    const settings = normalizeSettings(body.settings);
    if (poolOf(settings).length < MIN_POOL) return bad(400, "That leaves too few Pokémon. Widen the generations.");
    const st = startSolo(body.mode, settings, now, body.date);
    return NextResponse.json({ state: sealSolo(st), view: soloView(st, now) }, { headers: NO_STORE });
  }

  const st = openSolo(body.state);
  if (!st) return bad(400, "That game has expired. Start a new one.");
  if (body.action === "view") return NextResponse.json({ state: body.state, view: soloView(st, now) }, { headers: NO_STORE });
  const out = soloAct(st, body.action === "ask" ? { ask: body.q } : { guess: body.pokemon }, now);
  if (!out.ok) return bad(out.status, out.error);
  return NextResponse.json({ state: sealSolo(out.state), view: soloView(out.state, now) }, { headers: NO_STORE });
}
