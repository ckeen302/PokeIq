import { POKEDEX } from "@/lib/pokemon/pokedex";
import { LIVE_OTHER_LOCALES, type Locale } from "@/i18n/config";
import { speciesName } from "@/lib/names/species";

/**
 * The species a generation introduced ({id, slug, name}), for the timeline's sprite strip. Built once, served static.
 * "<gen>" is English; "<gen>-<lang>" (each live language) has the language's official names.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  const gens = [...new Set(POKEDEX.map((p) => p.gen))].map(String);
  return [...gens, ...LIVE_OTHER_LOCALES.flatMap((l) => gens.map((g) => `${g}-${l}`))].map((gen) => ({ gen }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ gen: string }> }) {
  const [g, lang] = (await params).gen.split("-");
  const gen = Number(g);
  const locale = (lang ?? "en") as Locale;
  const list = POKEDEX.filter((p) => p.gen === gen).map((p) => ({ id: p.id, slug: p.slug, name: speciesName(p.id, p.name, locale) }));
  return Response.json(list, { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } });
}
