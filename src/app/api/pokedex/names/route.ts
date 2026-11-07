import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import type { DexSearchEntry } from "@/lib/pokemon/dex-search";

/**
 * GET /api/pokedex/names — every Pokémon's [id, slug, name, category], for
 * the home page's search box (what the Pokédex list searches). Static and
 * fetched only once someone starts a search.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    POKEDEX.map((p): DexSearchEntry => [p.id, p.slug, p.name, p.genus]),
    { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } }
  );
}
