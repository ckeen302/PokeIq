import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { Dex } from "pokemon-showdown";
import randsets from "@/data/battle/randsets.json";
import type { RandSetsInfo } from "@/lib/battle/tooltip-calc";

/**
 * GET /api/battle/randsets?format=gen9randombattle&species=Garchomp: what a
 * random battle's Pokémon may have, from Showdown's own random-battle data
 * (public, the same for every battle): its level, possible abilities, moves
 * and Tera types, and the items its sets are given. The battle screen's
 * tooltips show these for a foe whose ability, item or moves haven't been
 * revealed yet. Read from src/data/battle/randsets.json, written by
 * scripts/build-randsets.ts from the installed pokemon-showdown, so no
 * request runs the generator (and nothing heavy loads).
 */

// The simulator runs on Node, and must stay unbundled (next.config.ts serverExternalPackages).
export const runtime = "nodejs";

const querySchema = z.object({
  format: z.enum(["gen9randombattle", "gen9randomdoublesbattle"]),
  species: z.string().min(1).max(40),
});

const tables = randsets.formats as Record<string, Record<string, RandSetsInfo>>;

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-randsets:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const species = Dex.species.get(query.data.species);
  if (!species.exists) return NextResponse.json({ error: "Unknown Pokémon." }, { status: 404 });
  const info = tables[query.data.format][species.id];
  if (!info) return NextResponse.json({ error: "Not in this format." }, { status: 404 });
  // The same for every battle on this engine version: browsers and the CDN may keep it.
  return NextResponse.json(info, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } });
}
