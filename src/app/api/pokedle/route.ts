import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidDailyDate } from "@/lib/daily";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { evaluate } from "@/lib/server/pokedle";

/**
 * POST /api/pokedle { date | practiceSeed, gens?, guesses: number[] }
 * Returns feedback for every guess so far (stateless recompute).
 */

const bodySchema = z
  .object({
    date: z.string().optional(),
    practiceSeed: z.string().min(4).max(32).optional(),
    gens: z.array(z.number().int().min(1).max(9)).max(9).optional(),
    guesses: z.array(z.number().int().positive()).max(12),
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
  const { date, practiceSeed, gens, guesses } = parsed.data;
  if (date && !isValidDailyDate(date)) {
    return NextResponse.json({ error: "That daily puzzle isn't available." }, { status: 400 });
  }

  const puzzle = date ? { id: `daily:${date}` } : { id: `practice:${practiceSeed}`, gens };
  return NextResponse.json(evaluate(puzzle, guesses), { headers: { "Cache-Control": "no-store" } });
}
