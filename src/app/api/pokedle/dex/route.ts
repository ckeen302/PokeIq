import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import type { DleDexRow } from "@/lib/dle-types";

/**
 * GET /api/pokedle/dex — every Pokémon you can guess in Pokédle, for the
 * Pokédex beside the board: name, generation and types only. Height,
 * weight, colour and stage stay out on purpose: those clues are worked out
 * from memory, and anything sent here could be read in the browser. The
 * same list for everyone and every puzzle (built once at build time), so it
 * says nothing about any answer.
 */

export const dynamic = "force-static";

export function GET() {
  const rows: DleDexRow[] = POKEDEX.map((p) => [p.id, p.name, p.gen, p.types[0], p.types[1] ?? null]);
  return NextResponse.json(rows, { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}
