import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { allFacts } from "@/lib/pikadoku/categories";

/** GET /api/pikadoku/dex: names for the picker's search, species and their forms as separate entries (no answers in it). `base` is the species: a form and its species are one Pokémon. */
export function GET() {
  const forms = allFacts()
    .filter((f) => f.form)
    .map((f) => ({ id: f.id, name: f.name, slug: f.slug ?? "", base: f.baseId, form: true }));
  return NextResponse.json(
    [...POKEDEX.map((p) => ({ id: p.id, name: p.name, slug: p.slug, base: p.id })), ...forms],
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
