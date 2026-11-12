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
  // Heavy endpoints that aren't pages: share-image renderers and the JSON a
  // page loads in the browser. Search engines rank the pages, not these.
  "/*/og$",
  "/*/og?",
  "/*/about-image",
  "/*/about-grid",
  "/quiz/which-pokemon/card/",
  "/pokedex/rankings/*/rows",
  "/pokedex/timeline/species/",
  "/*.json$",
];

/**
 * Link-preview fetchers (X, Facebook and iMessage, Discord, Slack, WhatsApp,
 * Telegram, LinkedIn, Reddit). A shared result or invite is the whole point
 * for them, so they may read those pages and their cards; they fetch one URL
 * per share, never crawl.
 */
const PREVIEW_BOTS = [
  "Twitterbot",
  "facebookexternalhit",
  "Facebot",
  "Discordbot",
  "Slackbot",
  "Slackbot-LinkExpanding",
  "WhatsApp",
  "TelegramBot",
  "LinkedInBot",
  "redditbot",
];
const PREVIEW_DISALLOW = ["/api/", "/admin", "/login", "/trainer"];

/** Crawlers that collect pages to train AI models: not welcome anywhere. */
const AI_TRAINING_BOTS = [
  "GPTBot",
  "CCBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "FacebookBot",
  "Amazonbot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "Timpibot",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const cards = await cardSitemapIds();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: PREVIEW_BOTS, allow: "/", disallow: PREVIEW_DISALLOW },
      { userAgent: AI_TRAINING_BOTS, disallow: "/" },
    ],
    sitemap: [`${SITE_URL}/sitemap.xml`, ...cards.map(({ id }) => `${SITE_URL}/pokedex/tcg/sitemap/${id}.xml`)],
  };
}
