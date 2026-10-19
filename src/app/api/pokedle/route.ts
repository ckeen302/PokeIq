import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlayableDailyDate } from "@/lib/daily";
import { DLE_HINT_KINDS } from "@/lib/dle-types";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { evaluate, hardModeError } from "@/lib/server/pokedle";

/**
 * POST /api/pokedle { date | practiceSeed, gens?, guesses: number[], hints?, hard? }
 * Returns feedback for every guess so far (stateless recompute), and the
 * hints asked for. In hard mode every guess must fit the clues before it.
 * A date can be any daily from launch to today (past ones for the archive).
 */

const bodySchema = z
  .object({
    date: z.string().optional(),
    practiceSeed: z.string().min(4).max(32).optional(),
    gens: z.array(z.number().int().min(1).max(9)).max(9).optional(),
    guesses: z.array(z.number().int().positive()).max(12),
    hints: z.array(z.enum(DLE_HINT_KINDS)).max(DLE_HINT_KINDS.length).optional(),
    hard: z.boolean().optional(),
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
  const { date, practiceSeed, gens, guesses, hints, hard } = parsed.data;
  if (date && !isPlayableDailyDate(date)) {
    return NextResponse.json({ error: "That daily puzzle isn't available." }, { status: 400 });
  }

  const puzzle = date ? { id: `daily:${date}` } : { id: `practice:${practiceSeed}`, gens };
  const misfit = hard ? hardModeError(puzzle, guesses) : null;
  if (misfit) return NextResponse.json({ error: misfit, hardMode: true }, { status: 400 });
  return NextResponse.json(evaluate(puzzle, guesses, hints), { headers: { "Cache-Control": "no-store" } });
}
