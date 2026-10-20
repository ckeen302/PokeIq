import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { duelNameSchema } from "@/lib/server/duel-core";
import { battlesEnabled } from "@/lib/server/battle-engine/store";
import { createCpuBattle, createLiveBattle } from "@/lib/server/battle-engine/service";
import { PLAY_FORMATS, BATTLE_TEAM_MAX, CPU_LEVELS, type BattleSeatResponse } from "@/lib/battle/play";

/**
 * POST /api/battle: start a battle and return its code, the creator's seat
 * token and their view:
 *   { mode: "cpu", name, format, level, team? }   against the computer, at /battle/play/<code>
 *   { mode: "pvp", name, format, team? }          a live battle with an invite link, at /battle/live/<code>
 * `team` (Showdown export text) is required for formats without random teams.
 */

// The simulator runs on Node, and must stay unbundled (next.config.ts serverExternalPackages).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };
const team = z.string().max(BATTLE_TEAM_MAX).optional();
const format = z.enum([...PLAY_FORMATS, "custom"]);
/** Format "custom" takes `rules` (custom-rules.ts), checked by Showdown's format parser before the battle starts. */
const rules = z.record(z.unknown()).optional();

const bodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("cpu"), name: duelNameSchema, format, level: z.enum(CPU_LEVELS).default("normal"), team, rules }),
  z.object({ mode: z.literal("pvp"), name: duelNameSchema, format, team, rules }),
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
  try {
    const out = body.mode === "cpu" ? await createCpuBattle(body) : await createLiveBattle(body);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    const seat: BattleSeatResponse = { code: out.code, token: out.token, view: out.view };
    return NextResponse.json(seat, { headers: NO_STORE });
  } catch (err) {
    console.error("[battle] create failed:", err);
    return NextResponse.json({ error: "Couldn't start a battle. Try again." }, { status: 503, headers: NO_STORE });
  }
}
