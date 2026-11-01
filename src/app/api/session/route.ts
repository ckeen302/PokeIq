import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DIFFICULTIES, FORMATS, MODULES } from "@/engines/types";
import { isValidDailyDate } from "@/lib/daily";
import { randomId, verifyToken } from "@/lib/server/crypto";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { startSession } from "@/lib/server/session";
import { optionalName } from "@/lib/name-filter";
import { filterFor } from "@/lib/modes";
import type { SessionSpec, ShareCard } from "@/lib/session-types";

/**
 * POST /api/session — start a run.
 *   { module, format, difficulty, gens? }   regular run (fresh random seed)
 *   { daily: "YYYY-MM-DD" }                 today's Daily Challenge (shared seed)
 *   { zoomDaily: "YYYY-MM-DD" }             today's one-Pokémon Zoom Reveal (shared seed, unranked)
 *   { challenge: "<share token>" }          replay a friend's exact quiz
 * An optional `name` goes on the share card (left off if it isn't fit to show).
 *
 * Challenge replays, repeat starts of a daily and generation-filtered runs
 * are marked `practice` in the signed spec: they play normally but can't be
 * submitted to the leaderboard (a replay can be learned by heart).
 */

/** Daily dates this browser has started, so a restart can't farm the board. */
const DAILY_COOKIE = "piq_daily";

const bodySchema = z.object({
  module: z.enum(MODULES).default("whos-that"),
  format: z.enum(FORMATS).default("classic"),
  difficulty: z.enum(DIFFICULTIES).default("medium"),
  gens: z.array(z.number().int().min(1).max(9)).max(9).optional(),
  daily: z.string().optional(),
  zoomDaily: z.string().optional(),
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
    if (startedDailies(request).includes(body.daily)) spec.practice = "repeat-daily";
  } else if (body.zoomDaily !== undefined) {
    if (!isValidDailyDate(body.zoomDaily)) {
      return NextResponse.json({ error: "That daily puzzle isn't available." }, { status: 400 });
    }
    spec = {
      module: "zoom-reveal",
      format: "classic",
      difficulty: "medium",
      seed: `zoom-daily:${body.zoomDaily}`,
      zoomDaily: body.zoomDaily,
      practice: "zoom-daily",
    };
  } else if (body.challenge) {
    const card = verifyToken<ShareCard>("share", body.challenge);
    if (!card) return NextResponse.json({ error: "Invalid challenge link." }, { status: 400 });
    // Same seed => identical questions. Not a daily entry, even if it replays one.
    spec = { module: card.m, format: card.f, difficulty: card.d, gens: card.g, seed: card.s, practice: "challenge" };
  } else {
    // Every generation (or anime series) selected is the same as no filter.
    const size = filterFor(body.module).chips.length;
    const unique = [...new Set(body.gens ?? [])].filter((g) => g <= size).sort((a, b) => a - b);
    const gens = unique.length > 0 && unique.length < size ? unique : undefined;
    spec = { module: body.module, format: body.format, difficulty: body.difficulty, gens, seed: randomId() };
    if (gens) spec.practice = "filtered";
  }

  try {
    const response = NextResponse.json(startSession(spec, optionalName(body.name)), {
      headers: { "Cache-Control": "no-store" },
    });
    if (spec.daily && !spec.practice) {
      // Keep the last few dates (players span time zones, so ±1 day is live).
      const dates = [spec.daily, ...startedDailies(request)].slice(0, 4).join(",");
      response.cookies.set(DAILY_COOKIE, dates, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/api/session",
        maxAge: 3 * 24 * 60 * 60,
      });
    }
    return response;
  } catch (err) {
    console.error("[api/session]", err);
    return NextResponse.json({ error: "Could not build this quiz." }, { status: 500 });
  }
}

function startedDailies(request: NextRequest): string[] {
  return (request.cookies.get(DAILY_COOKIE)?.value ?? "").split(",").filter(Boolean);
}
