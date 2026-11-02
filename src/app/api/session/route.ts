import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DIFFICULTIES, FORMATS, MODULES, SCOPES } from "@/engines/types";
import { isValidDailyDate } from "@/lib/daily";
import { randomId, verifyToken } from "@/lib/server/crypto";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { claimOnce, recallResponse, rememberResponse, requestFingerprint } from "@/lib/server/replay-guard";
import { beginHeld, holdSession, readSession, startSession } from "@/lib/server/session";
import { optionalName } from "@/lib/name-filter";
import { defaultGens, filterFor, playDifficulty } from "@/lib/modes";
import type { SessionSpec, ShareCard } from "@/lib/session-types";

/**
 * POST /api/session — start a run.
 *   { module, format, difficulty?, gens? }  regular run (fresh random seed); difficulty only counts for
 *                                           Whose Team and Real Shiny, other modes play their fixed tuning
 *   { daily: "YYYY-MM-DD" }                 today's Daily Challenge (shared seed)
 *   { zoomDaily: "YYYY-MM-DD" }             today's one-Pokémon Zoom Reveal (shared seed, unranked)
 *   { challenge: "<share token>" }          replay a friend's exact quiz
 * An optional `name` goes on the share card (left off if it isn't fit to show).
 *
 * Getting a regular run ready before the Start click (QuizSetup does it when
 * the page goes idle, or the Start button is hovered):
 *   { ...regular run, hold: true }   -> { token, sid, rules, lives, assets }: question 1's
 *                                       pictures / cry only, no prompt, options or clock
 *   { begin: "<held token>" }        -> { token, question }: question 1, its clock (and
 *                                       Blitz's run clock) starting now; once per held token
 * Nothing is stored for a held run until it's begun, so an unused one costs nothing.
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
  // Old links send a difficulty for every mode: tolerated, and mapped by playDifficulty.
  difficulty: z.enum(DIFFICULTIES).optional().catch(undefined),
  gens: z.array(z.number().int().min(1).max(9)).max(9).optional(),
  /** Whose Team Is This?: games only or anime only (absent: both). */
  scope: z.enum(SCOPES).optional(),
  daily: z.string().optional(),
  zoomDaily: z.string().optional(),
  challenge: z.string().max(4096).optional(),
  name: z.string().trim().max(24).optional(),
  hold: z.boolean().optional(),
  begin: z.string().min(10).max(16384).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  // Beginning a held run serves a question, like /api/session/next (and shares its limit).
  const begin = parsed.success ? parsed.data.begin : undefined;
  const allowed = begin ? rateLimit(`answer:${clientIp(request)}`, 60, 4) : rateLimit(`session:${clientIp(request)}`, 30, 0.5);
  if (!allowed) {
    return NextResponse.json({ error: "Too many runs started — take a breather." }, { status: 429 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const body = parsed.data;
  if (begin) return beginRun(begin);
  // Only a regular run can be held: a daily's start counts it as played, and challenges start as asked.
  if (body.hold && (body.daily !== undefined || body.zoomDaily !== undefined || body.challenge)) {
    return NextResponse.json({ error: "Only a regular run can be started ahead." }, { status: 400 });
  }

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
    spec = { module: card.m, format: card.f, difficulty: card.d, gens: card.g, seed: card.s, practice: "challenge", ...(card.o && { scope: card.o }) };
  } else {
    // Every generation (or anime series) selected is the same as no filter.
    const size = filterFor(body.module).chips.length;
    const unique = [...new Set(body.gens ?? [])].filter((g) => g <= size).sort((a, b) => a - b);
    const picked = unique.length > 0 && unique.length < size ? unique : undefined;
    // No filter plays every generation ("All" means all nine), not the old medium cap of Gens 1–5.
    const gens = picked ?? defaultGens(body.module);
    const scope = body.module === "whose-team" ? body.scope : undefined;
    // The adaptive test samples every level itself; the rest play the mode's difficulty.
    const difficulty = body.format === "adaptive" ? (body.difficulty ?? "medium") : playDifficulty(body.module, body.difficulty);
    spec = { module: body.module, format: body.format, difficulty, gens, seed: randomId(), ...(scope && { scope }) };
    // Like a generation filter, games-only or anime-only runs aren't ranked against full runs.
    if (picked || scope) spec.practice = "filtered";
  }

  try {
    const response = NextResponse.json(body.hold ? holdSession(spec, optionalName(body.name)) : startSession(spec, optionalName(body.name)), {
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

const NO_STORE = { "Cache-Control": "no-store" };

/** Serve a held run's question 1 and start its clock (see holdSession). */
function beginRun(token: string) {
  const state = readSession(token);
  if (!state) return NextResponse.json({ error: "Session expired or invalid — start a new run." }, { status: 401 });
  if (!state.h) return NextResponse.json({ error: "That run has already started." }, { status: 409 });
  const outcome = beginHeld(state);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return serveOnce(outcome.claimKey, requestFingerprint(token), outcome.response);
}

async function serveOnce<T>(claimKey: string, fingerprint: string, response: T) {
  const cached = recallResponse<T>(claimKey, fingerprint);
  if (cached) return NextResponse.json(cached, { headers: NO_STORE });
  if (!(await claimOnce(claimKey))) {
    return NextResponse.json({ error: "That run has already started." }, { status: 409 });
  }
  rememberResponse(claimKey, fingerprint, response);
  return NextResponse.json(response, { headers: NO_STORE });
}

function startedDailies(request: NextRequest): string[] {
  return (request.cookies.get(DAILY_COOKIE)?.value ?? "").split(",").filter(Boolean);
}
