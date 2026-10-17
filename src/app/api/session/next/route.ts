import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { nextQuestion, readSession, type NextOutcome } from "@/lib/server/session";
import type { NextResponse as NextQuestionResponse } from "@/lib/session-types";

/**
 * POST /api/session/next — { token } -> { token, question }.
 * Serves a timed run's next question and starts its clock now, so reading
 * the previous solution never eats into the next timer.
 */

const bodySchema = z.object({ token: z.string().min(10).max(16384) });

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (!rateLimit(`answer:${clientIp(request)}`, 60, 4)) {
    return NextResponse.json({ error: "Slow down, speedrunner." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { token } = parsed.data;

  const state = readSession(token);
  if (!state) {
    return NextResponse.json({ error: "Session expired or invalid — start a new run." }, { status: 401 });
  }

  const claimKey = `next:${state.sid}:${state.log.length}`;
  const fingerprint = requestFingerprint(token);
  const cached = recallResponse<NextQuestionResponse>(claimKey, fingerprint);
  if (cached) return NextResponse.json(cached, { headers: NO_STORE });

  let outcome: NextOutcome;
  try {
    outcome = nextQuestion(state);
  } catch (err) {
    console.error("[api/session/next]", err);
    return NextResponse.json({ error: "Couldn't load the next question — please start a new run." }, { status: 500 });
  }
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  if (!(await claimOnce(outcome.claimKey))) {
    return NextResponse.json({ error: "That question was already served." }, { status: 409 });
  }
  rememberResponse(outcome.claimKey, fingerprint, outcome.response);

  return NextResponse.json(outcome.response, { headers: NO_STORE });
}
