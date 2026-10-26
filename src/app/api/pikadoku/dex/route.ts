import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { allFacts } from "@/lib/pikadoku/categories";

/**
 * GET /api/pikadoku/dex: names for the picker's search, species and their forms
 * as separate entries (no answers in it). `b` is a form's species (a form and
 * its species are one Pokémon); a species leaves it out. Built once at build
 * time and cached by the browser for a day: ~40% smaller than with slugs.
 */
export const dynamic = "force-static";

export function GET() {
  const forms = allFacts()
    .filter((f) => f.form)
    .map((f) => ({ i: f.id, n: f.name, b: f.baseId }));
  return NextResponse.json([...POKEDEX.map((p) => ({ i: p.id, n: p.name })), ...forms], {
    headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
