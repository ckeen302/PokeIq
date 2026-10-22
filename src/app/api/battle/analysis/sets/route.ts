import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assumeSets, standins } from "@/lib/server/analysis-sets";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";

/**
 * POST /api/battle/analysis/sets { format, mons } -> { sets }: each Pokémon a
 * replay showed (species, level and what it revealed), filled out into a
 * full set for the analysis's simulations, saying where the rest came from.
 * Public data only; the same answer for everyone.
 */

export const runtime = "nodejs";

const name = z.string().max(60);
const bodySchema = z.object({
  format: z.string().regex(/^[a-z0-9]{1,40}$/),
  mons: z
    .array(
      z.object({
        key: z.string().max(80),
        species: name.min(1),
        level: z.number().int().min(1).max(100),
        moves: z.array(name).max(8),
        item: name.nullable(),
        ability: name.nullable(),
        teraType: name.nullable(),
      })
    )
    .min(1)
    .max(24),
  /** Per side: Pokémon brought but never shown, to stand in for. */
  unseen: z.tuple([z.number().int().min(0).max(6), z.number().int().min(0).max(6)]).default([0, 0]),
  /** Seeds the stand-ins (the replay's id), so an analysis is repeatable. */
  seed: z.string().max(40).default(""),
});

export async function POST(request: NextRequest) {
  if (!rateLimit(`battle-analysis-sets:${clientIp(request)}`, 20, 0.5)) return tooManyRequests();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { format, mons, unseen, seed } = parsed.data;
  const sets = await assumeSets(format, mons);
  const have = (side: 0 | 1) => mons.filter((m) => m.key.startsWith(`p${side + 1}:`)).map((m) => m.species);
  const extra = [...(await standins(format, 0, unseen[0], have(0), seed)), ...(await standins(format, 1, unseen[1], have(1), seed))];
  return NextResponse.json({ sets: [...sets, ...extra] }, { headers: { "Cache-Control": "no-store" } });
}
