import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BATTLE_TEAM_MAX } from "@/lib/battle/play";
import { checkRules, prepareCustomTeam } from "@/lib/server/battle-engine/custom";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { catalogueFormat, type FormatRules } from "@/lib/battle/format-catalogue";
import FORMAT_RULES from "@/data/battle/format-rules.json";

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

/**
 * GET /api/battle/rules?format=<id> -> the catalogue entry plus Showdown's
 * ruleset, bans, unbans and restricted lists for it (the picker's rules
 * drawer), straight from format-rules.json.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("format") ?? "";
  const format = catalogueFormat(id);
  const rules = (FORMAT_RULES as Record<string, FormatRules>)[id];
  if (!format || !rules) return NextResponse.json({ error: "No such format." }, { status: 404 });
  return NextResponse.json({ format, ...rules }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
