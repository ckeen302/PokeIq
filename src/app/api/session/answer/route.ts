import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce } from "@/lib/server/replay-guard";
import { recordAttempt } from "@/lib/server/calibration";
import { gradeAnswer, readSession } from "@/lib/server/session";

/** POST /api/session/answer — { token, choice } -> graded result + next question. */

const bodySchema = z.object({
  token: z.string().min(10).max(16384),
  choice: z.string().max(200).nullable(),
  /** Player's long-run rating, logged for calibration only (never trusted for scoring). */
  playerRating: z.number().min(0).max(3000).optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`answer:${clientIp(request)}`, 60, 4)) {
    return NextResponse.json({ error: "Slow down, speedrunner." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const state = readSession(parsed.data.token);
  if (!state) {
    return NextResponse.json({ error: "Session expired or invalid — start a new run." }, { status: 401 });
  }

  const outcome = gradeAnswer(state, parsed.data.choice);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  if (!(await claimOnce(outcome.claimKey))) {
    return NextResponse.json({ error: "That question was already answered." }, { status: 409 });
  }

  // Runs after the response is sent: calibration must never slow grading down.
  after(() => recordAttempt(outcome.itemKey, outcome.correct, outcome.rating, parsed.data.playerRating));

  return NextResponse.json(outcome.response, { headers: { "Cache-Control": "no-store" } });
}
