import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { cardSitemapIds } from "@/lib/tcg/card-index";

/**
 * Kept out of crawlers' way: the API, account and admin pages, and every page
 * that only means something to the people playing it (a duel, party or race
 * by its code, a shared result, a challenge link, a profile or a replay).
 * Those are noindex anyway, so crawling them only costs bandwidth. The games,
 * quizzes and the Pokédex (everything in the sitemap) stay open.
 */
const DISALLOW = [
  "/api/",
  "/admin",
  "/login",
  "/trainer",
  "/c/",
  "/s/",
  "/u/",
  "/guessr/c/",
  "/guessr/r/",
  "/guessr/duel/",
  "/guessr/party/",
  "/guessr/history",
  "/connections/c/",
  "/connections/duel/",
  "/connections/party/",
  "/pikadoku/duel/",
  "/pokedle/duel/",
  "/quiz/duel/",
  "/quiz/name-em-all/race/",
  "/quiz/which-pokemon/compare",
  "/battle/play/",
  "/battle/live/",
  "/battle/replay/",
  "/battle/insights",
  "/battle/player/",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const cards = await cardSitemapIds();
  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOW },
    sitemap: [`${SITE_URL}/sitemap.xml`, ...cards.map(({ id }) => `${SITE_URL}/pokedex/tcg/sitemap/${id}.xml`)],
  };
}
