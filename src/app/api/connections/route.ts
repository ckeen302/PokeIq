import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlayableConnDate, CONN_GROUP_SIZE, CONN_GROUPS, CONN_MAX_MISTAKES } from "@/lib/connections/types";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { checkGuesses, practiceConnPuzzle, puzzleView } from "@/lib/server/connections";
import { effectiveDaily } from "@/lib/server/connections-social";
import { startToken } from "@/lib/server/connections-board";
import { checkCustom, customView, getCustom } from "@/lib/server/connections-custom";
import { TILE_ID_MAX } from "@/lib/connections/tiles";
import { CUSTOM_SEED_RE } from "@/lib/connections/custom";

/**
 * PokéConnections.
 *
 * GET /api/connections?date=YYYY-MM-DD | ?practice=<seed>
 *   The puzzle's sixteen tiles in their starting order (ConnPuzzleResponse),
 *   never its groups.
 *
 * POST /api/connections { date | practice, guesses: number[][] }
 *   Every guess so far (four Pokémon ids each), played again in order
 *   (ConnGuessResponse): right, one away, wrong, or a repeat (free); the
 *   groups found; and once it's over (four groups found, or four mistakes)
 *   all four groups with their explanations. Stateless: nothing is stored.
 *
 * A date can be any daily from launch to today, wherever the player is.
 * Both are rate-limited per address.
 */

const NO_STORE = { "Cache-Control": "no-store" };
/** A practice seed, with Unlimited's difficulty in front when it isn't normal: "hard-x7k2abcd". */
const SEED = z.string().regex(/^(?:(?:easy|normal|hard)-)?[a-z0-9]{4,24}$/);

/** The puzzle a request names, or an error. */
async function puzzleFor(date: string | null | undefined, practice: string | null | undefined) {
  if (date && !practice) {
    if (!isPlayableConnDate(date)) return { error: "That daily puzzle isn't available." } as const;
    return { puzzle: await effectiveDaily(date), key: `daily:${date}`, date } as const;
  }
  if (practice && !date && SEED.safeParse(practice).success) return { puzzle: practiceConnPuzzle(practice), key: `practice:${practice}` } as const;
  return { error: "Ask for a daily (date) or a practice puzzle (practice)." } as const;
}

export async function GET(request: NextRequest) {
  if (!rateLimit(`conn-get:${clientIp(request)}`, 60, 1)) return tooManyRequests();
  const params = request.nextUrl.searchParams;
  // A community puzzle (/connections/c/<id>) plays as practice=custom-<id>: tiles only, from the creator's stored groups.
  const customId = CUSTOM_SEED_RE.exec(params.get("practice") ?? "")?.[1];
  if (customId && !params.get("date")) {
    const custom = await getCustom(customId);
    if (!custom) return NextResponse.json({ error: "That puzzle doesn't exist." }, { status: 404, headers: NO_STORE });
    return NextResponse.json(customView(custom), { headers: NO_STORE });
  }
  const found = await puzzleFor(params.get("date"), params.get("practice"));
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: 400, headers: NO_STORE });
  const view = puzzleView(found.puzzle, found.key, found.date);
  // A daily is timed from here, by the server's clock (see connections-board.ts).
  return NextResponse.json(found.date ? { ...view, start: startToken(found.date) } : view, { headers: NO_STORE });
}

const bodySchema = z.object({
  date: z.string().max(10).optional(),
  practice: z.string().max(32).optional(),
  // At most every group plus every mistake, and a few repeats.
  guesses: z
    .array(z.array(z.number().int().positive().max(TILE_ID_MAX)).length(CONN_GROUP_SIZE))
    .max(CONN_GROUPS + CONN_MAX_MISTAKES + 4),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-guess:${clientIp(request)}`, 40, 1)) return tooManyRequests("Too many guesses — slow down a little.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const customId = CUSTOM_SEED_RE.exec(parsed.data.practice ?? "")?.[1];
  if (customId && !parsed.data.date) {
    const custom = await getCustom(customId);
    if (!custom) return NextResponse.json({ error: "That puzzle doesn't exist." }, { status: 404, headers: NO_STORE });
    try {
      return NextResponse.json(checkCustom(custom, parsed.data.guesses), { headers: NO_STORE });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400, headers: NO_STORE });
    }
  }
  const found = await puzzleFor(parsed.data.date, parsed.data.practice);
  if ("error" in found) return NextResponse.json({ error: found.error }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json(checkGuesses(found.puzzle, parsed.data.guesses), { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400, headers: NO_STORE });
  }
}
