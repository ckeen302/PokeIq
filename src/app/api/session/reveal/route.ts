import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { playerRateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { readSession, revealCard, type RevealOutcome } from "@/lib/server/session";
import type { RevealResponse } from "@/lib/session-types";

/**
 * POST /api/session/reveal — { token } -> { token, card, reveal }.
 * Whose Team Is This? on Hard: the next Pokémon of the current team. Each
 * card is served once per session, and the returned token counts it, so the
 * answer is scored on how many were seen.
 */

const bodySchema = z.object({ token: z.string().min(10).max(16384) });

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  // Per run (its id is signed into the token): players sharing one address each have their own allowance.
  const state = parsed.success ? readSession(parsed.data.token) : null;
  if (!playerRateLimit(request, "answer", 60, 4, state?.sid)) {
    return NextResponse.json({ error: "Slow down, speedrunner." }, { status: 429 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { token } = parsed.data;

  if (!state) {
    return NextResponse.json({ error: "Session expired or invalid — start a new run." }, { status: 401 });
  }

  let outcome: RevealOutcome;
  try {
    outcome = revealCard(state);
  } catch (err) {
    console.error("[api/session/reveal]", err);
    return NextResponse.json({ error: "Couldn't reveal the next Pokémon." }, { status: 500 });
  }
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  // A retry of a request whose response was lost gets the same response back.
  const fingerprint = requestFingerprint(token);
  const cached = recallResponse<RevealResponse>(outcome.claimKey, fingerprint);
  if (cached) return NextResponse.json(cached, { headers: NO_STORE });

  if (!(await claimOnce(outcome.claimKey))) {
    return NextResponse.json({ error: "That Pokémon was already revealed — use your latest token." }, { status: 409 });
  }
  rememberResponse(outcome.claimKey, fingerprint, outcome.response);
  return NextResponse.json(outcome.response, { headers: NO_STORE });
}
