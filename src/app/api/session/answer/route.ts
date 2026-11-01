import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { calibrationSettled, recordAttempt } from "@/lib/server/calibration";
import { answerClaimKey, gradeAnswer, readSession, type AnswerOutcome } from "@/lib/server/session";
import type { AnswerResponse } from "@/lib/session-types";

/** POST /api/session/answer — { token, choice } -> graded result (+ next question in Blitz). */

const bodySchema = z.object({
  token: z.string().min(10).max(16384),
  choice: z.string().max(200).nullable(),
  /** Client-measured asset load time for this question (clamped server-side). */
  loadMs: z.number().int().min(0).max(600_000).optional(),
});

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!rateLimit(`answer:${clientIp(request)}`, 60, 4)) {
    return NextResponse.json({ error: "Slow down, speedrunner." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { token, choice, loadMs } = parsed.data;

  const state = readSession(token);
  if (!state) {
    return NextResponse.json({ error: "Session expired or invalid — start a new run." }, { status: 401 });
  }

  // A retry of a request whose response was lost gets the same response back.
  const fingerprint = requestFingerprint(token, choice);
  const cached = recallResponse<AnswerResponse>(answerClaimKey(state), fingerprint);
  if (cached) return NextResponse.json(cached, { headers: NO_STORE });

  let outcome: AnswerOutcome;
  try {
    outcome = gradeAnswer(state, choice, loadMs);
  } catch (err) {
    console.error("[api/session/answer]", err);
    return NextResponse.json({ error: "Couldn't load this question — please start a new run." }, { status: 500 });
  }
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  // Whose Team on Hard: an older token (fewer Pokémon revealed) can't answer once a newer one revealed more.
  if (outcome.revealGuard && !(await claimOnce(outcome.revealGuard))) {
    return NextResponse.json({ error: "You revealed more Pokémon since — answer with your latest token." }, { status: 409 });
  }

  if (!(await claimOnce(outcome.claimKey))) {
    return NextResponse.json({ error: "That question was already answered." }, { status: 409 });
  }
  rememberResponse(outcome.claimKey, fingerprint, outcome.response);

  // Runs after the response is sent: calibration must never slow grading down.
  if (outcome.record) {
    const { itemKey, correct, rating, playerRating } = outcome;
    after(async () => {
      await recordAttempt(itemKey, correct, rating, playerRating);
      await calibrationSettled();
    });
  }

  return NextResponse.json(outcome.response, { headers: NO_STORE });
}
