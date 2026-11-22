import type { MetadataRoute } from "next";
import { englishSitemap } from "@/lib/sitemap/entries";
import { withAlternates } from "@/lib/sitemap/languages";

// The English pages (every page has an English version). Card pages are in /pokedex/tcg/sitemap/<n>.xml
// (src/app/pokedex/tcg/sitemap.ts); each other live language has /<lang>/sitemap.xml (src/app/[locale]/sitemap.xml).
// TCG sets come from the Pokémon TCG API: refresh daily; without the API the sitemap simply omits them.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return withAlternates(await englishSitemap(), "en");
}
