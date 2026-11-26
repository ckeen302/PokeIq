import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce } from "@/lib/server/replay-guard";
import { hintFor, huntHintKey, readHunt } from "@/lib/server/hunt";
import { HUNT_HINTS } from "@/lib/hunt/types";
import { LOCALES } from "@/i18n/config";

/**
 * POST /api/geo/hunt/hint — { token, hint, locale? }. A hint for the round being played (its type, the
 * kind of place, or the games), and a new token that records it: the round's grading takes its cost off.
 * The hint also holds a single-use claim on the round, so an older token sent with the guess is charged
 * for it all the same. Asking again for a hint already given answers it again.
 */

const bodySchema = z.object({
  token: z.string().min(10).max(4096),
  hint: z.enum(HUNT_HINTS),
  locale: z.enum(LOCALES).optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`hunt-hint:${clientIp(request)}`, 40, 1)) {
    return NextResponse.json({ error: "Slow down, explorer." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const state = readHunt(parsed.data.token);
  if (!state) return NextResponse.json({ error: "Game expired or invalid. Start a new one." }, { status: 401 });
  const outcome = hintFor(state, parsed.data.hint, parsed.data.locale);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  // Taken: the claim stays, whatever happens to this response (a hint already given, or the round already graded, is answered again).
  await claimOnce(huntHintKey(state, parsed.data.hint));
  return NextResponse.json(outcome.body, { headers: { "Cache-Control": "no-store" } });
}
