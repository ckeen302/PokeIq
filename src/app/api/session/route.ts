import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DIFFICULTIES, FORMATS, MODULES } from "@/engines/types";
import { isValidDailyDate } from "@/lib/daily";
import { randomId, verifyToken } from "@/lib/server/crypto";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { startSession } from "@/lib/server/session";
import type { SessionSpec, ShareCard } from "@/lib/session-types";

/**
 * POST /api/session — start a run.
 *   { module, format, difficulty, gens? }   regular run (fresh random seed)
 *   { daily: "YYYY-MM-DD" }                 today's Daily Challenge (shared seed)
 *   { challenge: "<share token>" }          replay a friend's exact quiz
 */

const bodySchema = z.object({
  module: z.enum(MODULES).default("whos-that"),
  format: z.enum(FORMATS).default("classic"),
  difficulty: z.enum(DIFFICULTIES).default("medium"),
  gens: z.array(z.number().int().min(1).max(9)).max(9).optional(),
  daily: z.string().optional(),
  challenge: z.string().max(4096).optional(),
  name: z.string().trim().max(24).optional(),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`session:${clientIp(request)}`, 30, 0.5)) {
    return NextResponse.json({ error: "Too many runs started — take a breather." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;

  let spec: SessionSpec;
  if (body.daily !== undefined) {
    if (!isValidDailyDate(body.daily)) {
      return NextResponse.json({ error: "That daily puzzle isn't available." }, { status: 400 });
    }
    spec = { module: "mixed", format: "classic", difficulty: "medium", seed: `daily:${body.daily}`, daily: body.daily };
  } else if (body.challenge) {
    const card = verifyToken<ShareCard>("share", body.challenge);
    if (!card) return NextResponse.json({ error: "Invalid challenge link." }, { status: 400 });
    // Same seed => identical questions. Not a daily entry, even if it replays one.
    spec = { module: card.m, format: card.f, difficulty: card.d, gens: card.g, seed: card.s };
  } else {
    const gens = body.gens?.length ? [...new Set(body.gens)].sort() : undefined;
    spec = { module: body.module, format: body.format, difficulty: body.difficulty, gens, seed: randomId() };
  }

  try {
    return NextResponse.json(startSession(spec, body.name), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[api/session]", err);
    return NextResponse.json({ error: "Could not build this quiz." }, { status: 500 });
  }
}
