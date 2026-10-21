import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlayableDailyDate } from "@/lib/daily";
import { DLE_HINT_KINDS, DLE_SQUIRDLE_FROM } from "@/lib/dle-types";
import { DLE_ASSISTS } from "@/lib/dle-assist";
import { DLE_DAILY_FORMATS, dleRules, gensOfRange, rangeOfGens } from "@/lib/dle-format";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { dailyPuzzleOf, evaluate, hardModeError, practicePuzzle, puzzleRules } from "@/lib/server/pokedle";

/**
 * POST /api/pokedle { date, format? | practiceSeed, settings?, gens?, guesses: number[], hints?, hard?, assist?, timedOut? }
 * Returns feedback for every guess so far (stateless recompute), the
 * hints asked for and, once it's over, the points at the Pokédex assist
 * level the game was started at (the Notebook when none is sent).
 *
 * The rules come back with it (`rules`): a daily's are its format's, the
 * same for everyone (`format`: classic, the default, or squirdle); a
 * practice game's come from `settings` (dle-format's DleSettings: format,
 * clue columns, generation range, guesses, hints, close states, timer,
 * pool), cleaned up here. Only the columns the rules show are worked out
 * and sent. In hard mode every guess must fit the gen and type clues before
 * it. `timedOut` ends a timed practice game. A date can be any daily from
 * launch (or the Squirdle-style daily's start) to today.
 */

const bodySchema = z
  .object({
    date: z.string().optional(),
    format: z.enum(DLE_DAILY_FORMATS).optional(),
    practiceSeed: z.string().min(4).max(32).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    gens: z.array(z.number().int().min(1).max(9)).max(9).optional(),
    guesses: z.array(z.number().int().positive()).max(12),
    hints: z.array(z.enum(DLE_HINT_KINDS)).max(DLE_HINT_KINDS.length).optional(),
    hard: z.boolean().optional(),
    assist: z.enum(DLE_ASSISTS).optional(),
    timedOut: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.date) !== Boolean(b.practiceSeed), "Provide either date or practiceSeed");

export async function POST(request: NextRequest) {
  if (!rateLimit(`dle:${clientIp(request)}`, 60, 2)) {
    return NextResponse.json({ error: "Too many guesses — slow down." }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { date, format = "classic", practiceSeed, settings, gens, guesses, hints, hard, assist, timedOut } = parsed.data;
  if (date && (!isPlayableDailyDate(date) || (format === "squirdle" && date < DLE_SQUIRDLE_FROM))) {
    return NextResponse.json({ error: "That daily puzzle isn't available." }, { status: 400 });
  }

  // An older client sends just `gens` (a list) for practice: its range.
  const legacyGens = gens?.length ? rangeOfGens([...new Set(gens)]) : undefined;
  const practiceRules = dleRules({ ...(legacyGens && { gens: legacyGens }), ...settings });
  // A list that isn't a range (an old client's pick) keeps its exact generations.
  if (!settings && gens?.length && gensOfRange(...rangeOfGens(gens)).length !== new Set(gens).size) practiceRules.gens = [...new Set(gens)].sort((a, b) => a - b);
  const puzzle = date ? dailyPuzzleOf(date, format) : practicePuzzle(practiceSeed!, practiceRules);
  const rules = puzzleRules(puzzle) ?? practiceRules;
  const misfit = hard ? hardModeError(puzzle, guesses, rules) : null;
  if (misfit) return NextResponse.json({ error: misfit, hardMode: true }, { status: 400 });
  return NextResponse.json(evaluate(puzzle, guesses, hints, assist, rules, timedOut === true), { headers: { "Cache-Control": "no-store" } });
}
