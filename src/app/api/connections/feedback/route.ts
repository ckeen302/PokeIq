import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CONN_GROUP_SIZE, CONN_GROUPS, CONN_MAX_MISTAKES, type ConnLevel } from "@/lib/connections/types";
import { REPORT_REASONS, type ConnFeedbackResponse } from "@/lib/connections/social";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { NO_STORE, PLAYER, whoIs } from "@/lib/server/connections-custom-http";
import { connPlayerKey } from "@/lib/server/connections-results";
import { submitFeedback } from "@/lib/server/connections-social";

/**
 * POST /api/connections/feedback { date, player, guesses, rating?, report? }
 *
 * After a finished daily: a thumbs up (1) or down (-1) on the puzzle and/or
 * a report on one group (`report.level` 0 yellow to 3 purple, with a reason:
 * wrong-fact, unfair or too-obscure). One rating per player per puzzle and
 * one report per group; the first is kept. The server plays `guesses` again,
 * only takes feedback on a finished game, and looks the reported group's
 * category up itself: the client never names one.
 *
 * { available: false } when feedback isn't stored: the game works the same.
 */

const bodySchema = z
  .object({
    date: z.string().max(10),
    player: PLAYER.optional(),
    guesses: z
      .array(z.array(z.number().int().positive().max(100_000)).length(CONN_GROUP_SIZE))
      .min(1)
      .max(CONN_GROUPS + CONN_MAX_MISTAKES + 4),
    rating: z.union([z.literal(1), z.literal(-1)]).optional(),
    report: z.object({ level: z.number().int().min(0).max(3), reason: z.enum(REPORT_REASONS) }).optional(),
  })
  .refine((b) => b.rating !== undefined || b.report !== undefined, "Send a rating or a report.");

export async function POST(request: NextRequest) {
  if (!rateLimit(`conn-feedback:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
  const who = await whoIs(request, parsed.data.player);
  if (!who) return NextResponse.json({ error: "Missing player id." }, { status: 400, headers: NO_STORE });
  try {
    const { date, guesses, rating, report } = parsed.data;
    const out = await submitFeedback({ date, guesses, rating, player: connPlayerKey(who.identity), ...(report && { report: { level: report.level as ConnLevel, reason: report.reason } }) });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json({ available: out.available, rated: out.rated, reported: out.reported } satisfies ConnFeedbackResponse, { headers: NO_STORE });
  } catch (err) {
    console.error("[connections] feedback failed:", err);
    return NextResponse.json({ available: false } satisfies ConnFeedbackResponse, { headers: NO_STORE });
  }
}
