import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { cardSitemapIds } from "@/lib/tcg/card-index";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const cards = await cardSitemapIds();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/c/", "/trainer"] },
    sitemap: [`${SITE_URL}/sitemap.xml`, ...cards.map(({ id }) => `${SITE_URL}/pokedex/tcg/sitemap/${id}.xml`)],
  };
}
