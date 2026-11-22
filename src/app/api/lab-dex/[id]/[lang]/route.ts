import { NextResponse } from "next/server";
import { LIVE_OTHER_LOCALES, type OtherLocale } from "@/i18n/config";
import { getT } from "@/i18n/server";
import pokemonData from "@/messages/pokemon-data";
import { labIds } from "@/lib/lab-dex/data";
import { labDetailsIn } from "@/lib/lab-dex/local";

/**
 * GET /api/lab-dex/:id/:lang — one Pokémon's details for the Professor's Lab in another live language (its Pokédex
 * entry, abilities and evolution line in that language), built at build time like ../route.ts. English uses
 * ../route.ts as before; an English-only build has none of these.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams({ params }: { params: { id?: string } }) {
  const ids = params?.id ? [params.id] : labIds().map(String);
  return ids.flatMap((id) => LIVE_OTHER_LOCALES.map((lang) => ({ id, lang })));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; lang: string }> }) {
  const { id, lang } = await context.params;
  if (!(LIVE_OTHER_LOCALES as readonly string[]).includes(lang)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const details = labDetailsIn(Number(id), lang as OtherLocale, await getT(pokemonData, lang as OtherLocale));
  if (!details) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(details);
}
