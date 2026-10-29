import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { learnAbout } from "@/lib/server/geo-learn";

/**
 * GET /api/geo/learn?name=&region=&parent= — the learn card's fact about a
 * place that has just been revealed. It only ever names places the player
 * already knows (the card asks after the guess), and the answer is the
 * public Pokédex's data, so it caches.
 */

const querySchema = z.object({
  name: z.string().trim().min(1).max(80),
  region: z.string().trim().min(1).max(40),
  parent: z.string().trim().min(1).max(80).optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { name, region, parent } = parsed.data;
  return NextResponse.json(learnAbout(name, region, parent), { headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } });
}
