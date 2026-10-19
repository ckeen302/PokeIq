import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { traitsOf } from "@/lib/server/pokedle";
import type { DleDexRow } from "@/lib/dle-types";

/**
 * GET /api/pokedle/dex — every Pokémon you can guess in Pokédle, with
 * exactly the attributes its clues are about, for the reference Pokédex
 * beside the board. The same list for everyone and every puzzle (built once
 * at build time), so it says nothing about any answer.
 */

export const dynamic = "force-static";

export function GET() {
  const rows: DleDexRow[] = POKEDEX.map((p) => {
    const t = traitsOf(p);
    return [p.id, p.name, t.gen, t.type1, t.type2, t.height, t.weight, t.color, t.stage];
  });
  return NextResponse.json(rows, { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}
