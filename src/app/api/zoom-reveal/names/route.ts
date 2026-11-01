import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";

/**
 * GET /api/zoom-reveal/names — every Pokémon's [id, name, generation], for
 * the guess box's suggestions (the same list Pokédle's box uses). Static:
 * it's the whole Pokédex, so it says nothing about any question.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    POKEDEX.map((p) => [p.id, p.name, p.gen]),
    { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } }
  );
}
