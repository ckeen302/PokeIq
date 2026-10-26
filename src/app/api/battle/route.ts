import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gate } from "@/lib/server/moderation";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel-core";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { createCpuBattle, createLiveBattle } from "@/lib/server/battle-engine/service";
import { battlePlayerKey } from "@/lib/server/battle-engine/identity";
import { ALL_FORMATS, BATTLE_TEAM_MAX, CPU_LEVELS, type BattleSeatResponse, type StandardFormatId } from "@/lib/battle/play";

/**
 * POST /api/battle: start a battle and return its code, the creator's seat
 * token and their view:
 *   { mode: "cpu", name, format, level, team? }   against the computer, at /battle/play/<code>
 *   { mode: "pvp", name, format, team?, public?, timer? }
 *        a live battle with an invite link, at /battle/live/<code>; private
 *        unless `public` (listed in the Watch lobby); `timer: false` starts
 *        it with the turn timer off, for either player to start; `timeoutLoses`: running out the clock once loses; `hidden`:
 *        "Don't allow spectators" (nobody but the two trainers can watch)
 * `team` (Showdown export text) is required for formats without random teams.
 */

// The simulator runs on Node, and must stay unbundled (next.config.ts serverExternalPackages).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const team = z.string().max(BATTLE_TEAM_MAX).optional();
const format = z.enum(["custom", ...ALL_FORMATS] as [StandardFormatId | "custom", ...(StandardFormatId | "custom")[]]);
/** Format "custom" takes `rules` (custom-rules.ts), checked by Showdown's format parser before the battle starts. */
const rules = z.record(z.unknown()).optional();
/** The browser's signed id (see /api/battle/id), for the trainer's battle record and replays. */
const rankedId = z.string().max(200).optional();

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("cpu"), name: duelNameSchema, format, level: z.enum(CPU_LEVELS).default("normal"), team, rules, rankedId }),
  z.object({ mode: z.literal("pvp"), name: duelNameSchema, format, team, rules, rankedId, public: z.boolean().default(false), hidden: z.boolean().default(false), timer: z.boolean().default(true), timeoutLoses: z.boolean().default(true) }),
]);

export async function POST(request: NextRequest) {
  if (!rateLimit(`battle-new:${clientIp(request)}`, 10, 0.2)) {
    return NextResponse.json({ error: "Too many battles started. Take a breather." }, { status: 429, headers: NO_STORE });
  }
  if (!battlesEnabled()) {
    return NextResponse.json({ error: "Battles aren't enabled on this server yet." }, { status: 503, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const body = parsed.data;
  if (body.mode === "pvp") {
    const blocked = await gate(request, "play");
    if (blocked) return blocked;
  }
  try {
    const player = (await battlePlayerKey(request, body.rankedId)) ?? undefined;
    const out = body.mode === "cpu" ? await createCpuBattle({ ...body, player }) : await createLiveBattle({ ...body, player });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const seat: BattleSeatResponse = { code: out.code, token: out.token, view: out.view };
    return NextResponse.json(seat, { headers: NO_STORE });
  } catch (err) {
    console.error("[battle] create failed:", err);
    return NextResponse.json({ error: "Couldn't start a battle. Try again." }, { status: 503, headers: NO_STORE });
  }
}
