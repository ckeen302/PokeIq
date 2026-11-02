import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { battleProfile } from "@/lib/server/battle-engine/records";
import { accountBattleKey, battlePlayerKey } from "@/lib/server/battle-engine/identity";
import { USERNAME_RE } from "@/lib/server/auth";
import { PLAY_FORMAT_INFO, type PlayFormatId } from "@/lib/battle/play";
import { versusRecord, type BattleVersusResponse } from "@/lib/battle/versus";

/**
 * GET /api/battle/versus?names=a,b&format=gen9randombattle — the battle
 * records for the versus intro before a battle: yours (header x-ranked-id:
 * this browser's signed id; a signed-in trainer is their account) and up to
 * two other trainers' by account name (what their public battle profile
 * shows). Names that aren't accounts come back null.
 */

const querySchema = z.object({
  names: z
    .string()
    .max(64)
    .optional()
    .transform((s) => [...new Set((s ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean))])
    .pipe(z.array(z.string()).max(2)),
  format: z.string().max(40).optional(),
});

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-versus:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const format = query.data.format && query.data.format in PLAY_FORMAT_INFO ? (query.data.format as PlayFormatId) : null;
  const out: BattleVersusResponse = { you: null, names: Object.fromEntries(query.data.names.map((n) => [n, null])) };
  try {
    const key = await battlePlayerKey(request, request.headers.get("x-ranked-id"));
    if (key) out.you = versusRecord(await battleProfile(key, 5), format);
    await Promise.all(
      query.data.names
        .filter((n) => USERNAME_RE.test(n))
        .map(async (name) => {
          const account = await accountBattleKey(name);
          if (account) out.names[name] = versusRecord(await battleProfile(account.key, 5), format);
        })
    );
  } catch (err) {
    console.error("[battle-versus]", err);
  }
  return NextResponse.json(out satisfies BattleVersusResponse, { headers: NO_STORE });
}
