import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Dex, Teams } from "pokemon-showdown";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import type { RandSetsInfo } from "@/lib/battle/tooltip-calc";

/**
 * GET /api/battle/randsets?format=gen9randombattle&species=Garchomp: what a
 * random battle's Pokémon may have, from Showdown's own random-battle data
 * (public, the same for every battle): its level, possible abilities, moves
 * and Tera types, and the items its sets are given (drawn from Showdown's
 * own generator). The battle screen's tooltips show these for a foe whose
 * ability, item or moves haven't been revealed yet.
 */

export const runtime = "nodejs";

const querySchema = z.object({
  format: z.enum(["gen9randombattle", "gen9randomdoublesbattle"]),
  species: z.string().min(1).max(40),
});

type SetsFile = Record<string, { level?: number; sets: { movepool: string[]; abilities: string[]; teraTypes?: string[] }[] }>;
let data: Promise<Record<string, SetsFile>> | null = null;
const loadSets = () =>
  (data ??= Promise.all([
    import("pokemon-showdown/dist/data/random-battles/gen9/sets.json"),
    import("pokemon-showdown/dist/data/random-battles/gen9/doubles-sets.json"),
  ]).then(([singles, doubles]) => ({
    gen9randombattle: (singles.default ?? singles) as SetsFile,
    gen9randomdoublesbattle: (doubles.default ?? doubles) as SetsFile,
  })));

const cache = new Map<string, RandSetsInfo>();
const uniq = (list: string[]) => [...new Set(list)].sort();

function itemsFor(format: string, species: string): string[] {
  const generator = Teams.getGenerator(format) as unknown as { randomSet: (s: string, teamDetails: object, isLead: boolean, isDoubles: boolean) => { item?: string } };
  const items: string[] = [];
  for (let i = 0; i < 48; i++) {
    try {
      const set = generator.randomSet(species, {}, i % 4 === 0, format === "gen9randomdoublesbattle");
      if (set.item) items.push(set.item);
    } catch {
      break;
    }
  }
  return uniq(items);
}

export async function GET(request: NextRequest) {
  if (!rateLimit(`battle-randsets:${clientIp(request)}`, 60, 2)) return tooManyRequests();
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { format } = query.data;
  const species = Dex.species.get(query.data.species);
  if (!species.exists) return NextResponse.json({ error: "Unknown Pokémon." }, { status: 404 });
  const key = `${format}:${species.id}`;
  let info = cache.get(key);
  if (!info) {
    const entry = (await loadSets())[format][species.id];
    if (!entry) return NextResponse.json({ error: "Not in this format." }, { status: 404 });
    info = {
      level: entry.level ?? null,
      abilities: uniq(entry.sets.flatMap((s) => s.abilities)),
      moves: uniq(entry.sets.flatMap((s) => s.movepool)),
      teraTypes: uniq(entry.sets.flatMap((s) => s.teraTypes ?? [])),
      items: itemsFor(format, species.name),
    };
    cache.set(key, info);
  }
  // The same for every battle on this engine version: browsers and the CDN may keep it.
  return NextResponse.json(info, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } });
}
