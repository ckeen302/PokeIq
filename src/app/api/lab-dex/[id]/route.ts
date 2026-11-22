import { NextResponse } from "next/server";
import { labDetails, labIds } from "@/lib/lab-dex/data";

/**
 * GET /api/lab-dex/:id — one Pokémon's longer text for the Professor's Lab
 * (/lab/pokedex): a Pokédex entry, its abilities and its evolution line.
 * Built once at build time for every species and form on the wheel and
 * served as static JSON, so picking a Pokémon loads a few hundred bytes
 * instead of the whole Pokédex.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return labIds().map((id) => ({ id: String(id) }));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const details = labDetails(Number((await context.params).id));
  if (!details) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(details);
}
