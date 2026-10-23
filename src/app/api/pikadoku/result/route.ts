import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { sessionTokenHash, userFromRequest } from "@/lib/server/auth";
import { duelNameSchema } from "@/lib/server/duel-core";
import { parseSettings } from "@/lib/server/pikadoku";
import { gridFields, historySchema } from "@/lib/server/pikadoku-http";
import { finishGame } from "@/lib/server/pikadoku-result";
import type { PdkDifficulty } from "@/lib/pikadoku/types";

/**
 * POST /api/pikadoku/result { date | practice, difficulty, settings, guesses, giveUp?, player, start?, name? }
 *
 * The server plays every guess again. Only once that replay says the game is
 * over does it answer: the uniqueness score and each cell's rarity, computed
 * from the recorded answers, today's rank, and the answers reveal. The first
 * result per trainer and day is kept.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const bodySchema = z.object({
  ...gridFields,
  guesses: historySchema,
  giveUp: z.boolean().optional(),
  player: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Bad player id."),
  start: z.string().max(400).optional(),
  name: duelNameSchema.optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`pdk-result:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const d = parsed.data;
  let user = null;
  if (sessionTokenHash(request)) user = await userFromRequest(request).catch(() => null);
  try {
    const out = await finishGame({
      date: d.date,
      difficulty: d.difficulty as PdkDifficulty,
      practice: d.practice,
      archive: d.archive,
      settings: parseSettings(d.settings),
      guesses: d.guesses,
      giveUp: d.giveUp,
      identity: user ? `u:${user.id}` : `d:${d.player}`,
      name: user ? user.username : (d.name ?? null),
      start: d.start,
    });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json(out.result, { headers: NO_STORE });
  } catch (err) {
    console.error("[pikadoku] result failed:", err);
    return NextResponse.json({ error: "Couldn't finish the game." }, { status: 503, headers: NO_STORE });
  }
}
