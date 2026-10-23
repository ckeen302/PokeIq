import { NextResponse } from "next/server";
import { POKEDEX } from "@/lib/pokemon/pokedex";

/** GET /api/pikadoku/dex: names for the picker's search (no answers in it). */
export function GET() {
  return NextResponse.json(
    POKEDEX.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
  );
}
