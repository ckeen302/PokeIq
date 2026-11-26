import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { secretIsSecure } from "@/lib/server/crypto";
import { GAMEPLAY_IP_LIMIT, clientIp, playerRateLimit, rateLimit } from "@/lib/server/rate-limit";
import { BOARD_FULL, claimBoardSlot, plausibleMs } from "@/lib/server/board-guard";
import { isHuntDailyDate, readHuntResult } from "@/lib/server/hunt";
import { readHuntBoard, saveHuntBoard } from "@/lib/server/hunt-board";
import { HUNT_MAX_ROUND_SCORE, HUNT_ROUNDS } from "@/lib/hunt/types";

/**
 * The Daily Hunt's leaderboard.
 *
 *   GET  /api/geo/hunt/leaderboard?date=YYYY-MM-DD → { available: true, rows } | { available: false }
 *   POST /api/geo/hunt/leaderboard { resultToken, playerName } → { saved: true }
 *
 * The score comes only from the signed result (the server graded every round). Guards as PokéGuessr's
 * board: a result is used once (one row per game), a name once a day, an address gets a few entries a
 * day, a Daily played again on the same device isn't signed for the board at all, and a time no person
 * could play in isn't ranked. Without the table (migration 0057 not applied) the board says it's
 * unavailable and the page hides it.
 */

const bodySchema = z.object({
  resultToken: z.string().min(10).max(4096),
  playerName: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N} _.\-']+$/u, "Use letters, numbers, spaces, _ . - ' only")
    .refine(isCleanName, NAME_REJECTED),
});

/** The fastest believable Daily Hunt: five Pokémon to read and pin. */
const HUNT_MIN_MS = 10_000;

export async function GET(request: NextRequest) {
  if (!rateLimit(`hunt-board:${clientIp(request)}`, 60, 1)) return NextResponse.json({ error: "Slow down." }, { status: 429 });
  const date = request.nextUrl.searchParams.get("date");
  if (!isHuntDailyDate(date)) return NextResponse.json({ error: "Unknown date." }, { status: 400 });
  const board = await readHuntBoard(date);
  // A short shared cache: the board is the same for everyone.
  const headers = { "Cache-Control": "public, max-age=0, s-maxage=20, stale-while-revalidate=60" };
  return NextResponse.json(board === "unavailable" ? { available: false } : { available: true, rows: board.rows }, { headers });
}

export async function POST(request: NextRequest) {
  const raw: unknown = await request.json().catch(() => ({}));
  const signed = readHuntResult((raw as { resultToken?: unknown })?.resultToken);
  if (!playerRateLimit(request, "hunt-lb", ...GAMEPLAY_IP_LIMIT, signed?.sid)) {
    return NextResponse.json({ error: "Too many submissions. Try again in a minute." }, { status: 429 });
  }
  if (process.env.NODE_ENV === "production" && !secretIsSecure()) {
    return NextResponse.json({ error: "Leaderboard disabled until the server secret is configured." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const result = readHuntResult(parsed.data.resultToken);
  if (!result) return NextResponse.json({ error: "This result can't go on the board (it's too old, or not a Daily Hunt)." }, { status: 400 });
  if (!isHuntDailyDate(result.date)) return NextResponse.json({ error: "That Daily Hunt is over." }, { status: 410 });
  if (result.rounds.length !== HUNT_ROUNDS || result.score > HUNT_ROUNDS * HUNT_MAX_ROUND_SCORE || !plausibleMs(result.durationMs, HUNT_MIN_MS)) {
    return NextResponse.json({ error: "This result can't be ranked." }, { status: 403 });
  }
  if (!(await claimBoardSlot(clientIp(request), "hunt-daily", result.date))) return NextResponse.json({ error: BOARD_FULL }, { status: 429 });
  const outcome = await saveHuntBoard({ date: result.date, sid: result.sid, name: parsed.data.playerName, score: result.score, rounds: result.rounds, durationMs: result.durationMs });
  if (outcome === "saved") return NextResponse.json({ saved: true });
  if (outcome === "duplicate") return NextResponse.json({ error: "Already on the board (one entry per game, and per name each day)." }, { status: 409 });
  if (outcome === "unavailable") return NextResponse.json({ error: "The Daily Hunt's board isn't open yet.", unavailable: true }, { status: 503 });
  return NextResponse.json({ error: "Couldn't save your score." }, { status: 503 });
}
