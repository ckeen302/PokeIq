import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { gradeHunt, readHunt } from "@/lib/server/hunt";
import { HUNT_MAX_PINS } from "@/lib/hunt/types";

/**
 * POST /api/geo/hunt/guess — { token, pins, timeout? }. Graded here: the
 * pins are matched to the Pokémon's regions, and the answer (every real spot)
 * comes back with the next Pokémon.
 */

const pin = z.object({ x: z.number().finite(), y: z.number().finite() });
const bodySchema = z.object({
  token: z.string().min(10).max(4096),
  pins: z.array(pin).max(HUNT_MAX_PINS),
  timeout: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`hunt-guess:${clientIp(request)}`, 40, 1)) {
    return NextResponse.json({ error: "Slow down, explorer." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (!parsed.data.pins.length && !parsed.data.timeout) return NextResponse.json({ error: "Drop a pin first." }, { status: 400 });

  const state = readHunt(parsed.data.token);
  if (!state) return NextResponse.json({ error: "Game expired or invalid. Start a new one." }, { status: 401 });
  const outcome = gradeHunt(state, parsed.data);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  // Each round is graded once; an identical retry (a lost response) gets the same answer back.
  const fingerprint = requestFingerprint(parsed.data.token, JSON.stringify(parsed.data.pins), parsed.data.timeout ? "timeout" : "");
  if (!(await claimOnce(outcome.claimKey))) {
    const cached = recallResponse(outcome.claimKey, fingerprint);
    if (cached) return NextResponse.json(cached, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "That round was already guessed." }, { status: 409 });
  }
  rememberResponse(outcome.claimKey, fingerprint, outcome.body);
  return NextResponse.json(outcome.body, { headers: { "Cache-Control": "no-store" } });
}
