import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { CARDS_PER_SITEMAP, allCardIds, cardSitemapIds } from "@/lib/tcg/card-index";

/**
 * Every TCG card page, from the committed card index (no API call), split
 * into /pokedex/tcg/sitemap/<n>.xml files under the 50,000-URL limit.
 * Listed in robots.txt next to /sitemap.xml.
 */

export async function generateSitemaps() {
  return cardSitemapIds();
}

export default async function sitemap({ id }: { id: number | string }): Promise<MetadataRoute.Sitemap> {
  const n = Number(id) || 0;
  const ids = (await allCardIds()).slice(n * CARDS_PER_SITEMAP, (n + 1) * CARDS_PER_SITEMAP);
  return ids.map((cardId) => ({ url: `${SITE_URL}/pokedex/tcg/card/${cardId}`, changeFrequency: "weekly" as const, priority: 0.3 }));
}
