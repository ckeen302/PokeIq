import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema, pvpToken } from "@/lib/server/duel-core";
import { duelsEnabled, newDuelCode, pvpStore } from "@/lib/server/duel-store";
import { duelView, type PvpDuel } from "@/lib/server/duels";
import { createPokedleDuel } from "@/lib/server/pokedle-duel";
import { createQuizDuel } from "@/lib/server/quiz-duel";
import { createConnectionsDuel } from "@/lib/server/connections-duel";
import { createPikadokuDuel } from "@/lib/server/pikadoku-duel";
import { DIFFICULTIES, MODULES } from "@/engines/types";
import { PLAY_MODULES } from "@/lib/modes";
import { DLE_ASSISTS } from "@/lib/dle-assist";
import type { PvpSeatResponse } from "@/lib/pvp-types";

/**
 * POST /api/duel — open a duel and return its code, the creator's player
 * token and the lobby:
 *   { kind: "pokedle", name, assist?, settings? }    a Pokédle duel, at /pokedle/duel/<code> (assist: the Pokédex level; settings: the format and settings; both changeable in the lobby)
 *   { kind: "quiz", name, module, difficulty }       a quiz duel, at /quiz/duel/<code>
 *   { kind: "connections", name, size? }             a PokéConnections race (size 4 or 5: a 5×5 board), at /connections/duel/<code>
 *   { kind: "pikadoku", name, turnSecs?, families? } a Pikadoku Tic Tac Toe duel, at /pikadoku/duel/<code>
 */

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pokedle"), name: duelNameSchema, assist: z.enum(DLE_ASSISTS).optional(), settings: z.record(z.string(), z.unknown()).optional() }),
  z.object({
    kind: z.literal("quiz"),
    name: duelNameSchema,
    module: z.enum(MODULES).refine((m) => PLAY_MODULES.includes(m), "Unknown quiz mode."),
    difficulty: z.enum(DIFFICULTIES).default("medium"),
  }),
  z.object({ kind: z.literal("connections"), name: duelNameSchema, size: z.union([z.literal(4), z.literal(5)]).optional() }),
  z.object({ kind: z.literal("pikadoku"), name: duelNameSchema, turnSecs: z.number().int().min(10).max(90).optional(), families: z.array(z.string().max(12)).max(6).optional(), steals: z.boolean().optional() }),
]);

export async function POST(request: NextRequest) {
  if (!rateLimit(`duel-new:${clientIp(request)}`, 10, 0.2)) {
    return NextResponse.json({ error: "Too many duels started — take a breather." }, { status: 429 });
  }
  if (!duelsEnabled()) {
    return NextResponse.json({ error: "Duels aren't enabled on this server yet." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  const blocked = await gate(request, "play");
  if (blocked) return blocked;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const now = Date.now();
      const code = newDuelCode();
      const { duel, playerId }: { duel: PvpDuel; playerId: string } =
        body.kind === "pokedle"
          ? createPokedleDuel(body.name, code, now, undefined, { assist: body.assist, settings: body.settings })
          : body.kind === "quiz"
            ? createQuizDuel(body.module, body.difficulty, body.name, code, now)
            : body.kind === "pikadoku"
              ? createPikadokuDuel(body.name, code, now, { turnSecs: body.turnSecs, families: body.families, steals: body.steals })
              : createConnectionsDuel(body.name, code, now, undefined, { size: body.size });
      if (!(await pvpStore.insert(duel))) continue; // code taken: roll another
      const seat: PvpSeatResponse = { code, token: pvpToken(code, playerId), view: duelView(duel, playerId, now, 0) };
      return NextResponse.json(seat, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Couldn't open a duel. Try again." }, { status: 503 });
  } catch (err) {
    console.error("[duel] create failed:", err);
    return NextResponse.json({ error: "Couldn't open a duel. Try again." }, { status: 503 });
  }
}
