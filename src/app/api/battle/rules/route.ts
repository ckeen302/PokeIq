import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BATTLE_TEAM_MAX } from "@/lib/battle/play";
import { checkRules, prepareCustomTeam } from "@/lib/server/battle-engine/custom";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

/**
 * POST /api/battle/rules { rules, team? } -> { ok, errors, teamErrors }
 * Checks a custom ruleset with Pokémon Showdown's own format parser and, if a
 * team comes with it, that team with Showdown's TeamValidator for exactly
 * that ruleset. `errors` and `teamErrors` are Showdown's messages.
 */

export const runtime = "nodejs";

const bodySchema = z.object({ rules: z.record(z.unknown()), team: z.string().max(BATTLE_TEAM_MAX).optional() });

export async function POST(request: NextRequest) {
  if (!rateLimit(`battle-rules:${clientIp(request)}`, 60, 2)) {
    return NextResponse.json({ error: "Too many checks — slow down a little." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That doesn't look like a ruleset." }, { status: 400 });
  const checked = checkRules(parsed.data.rules);
  if (!checked.ok) return NextResponse.json({ ok: false, errors: checked.errors, teamErrors: [] }, { headers: { "Cache-Control": "no-store" } });
  const team = parsed.data.team?.trim() ? prepareCustomTeam(checked.rules, parsed.data.team) : null;
  return NextResponse.json(
    { ok: !team || team.ok, errors: [], teamErrors: team && !team.ok ? team.errors : [] },
    { headers: { "Cache-Control": "no-store" } }
  );
}
