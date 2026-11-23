import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { cardSitemapIds } from "@/lib/tcg/card-index";
import { LIVE_OTHER_LOCALES } from "@/i18n/config";

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
  "/pokeguessr/c/",
  "/pokeguessr/r/",
  "/pokeguessr/duel/",
  "/pokeguessr/party/",
  "/pokeguessr/history",
  "/pokeconnections/c/",
  "/pokeconnections/duel/",
  "/pokeconnections/party/",
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

/**
 * AI search and answer engines, and the fetchers a person triggers from them
 * (ChatGPT search, Claude, Perplexity): they read pages to answer and cite
 * them, so they get the same access as search engines. Named explicitly
 * because a bot obeys only its most specific group. Google-Extended is here
 * too: it controls whether Gemini (the app and grounding) may use and cite
 * the site, alongside Gemini training (Google offers no way to split them);
 * Google's AI Overviews and AI Mode follow Googlebot regardless.
 */
const AI_SEARCH_BOTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended"];

/** Crawlers that only collect pages to train AI models (their companies' search bots above are separate): not welcome anywhere. */
const AI_TRAINING_BOTS = [
  "GPTBot",
  "CCBot",
  "ClaudeBot",
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

/** A rule's paths in every live language too (/es/trainer...); exactly the English list while English is the only one. */
const everyLanguage = (paths: string[]) => [...paths, ...LIVE_OTHER_LOCALES.flatMap((l) => paths.filter((p) => p.startsWith("/") && !p.startsWith("/api/") && !p.startsWith("/*")).map((p) => `/${l}${p}`))];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const cards = await cardSitemapIds();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: everyLanguage(DISALLOW) },
      { userAgent: PREVIEW_BOTS, allow: "/", disallow: everyLanguage(PREVIEW_DISALLOW) },
      { userAgent: AI_SEARCH_BOTS, allow: "/", disallow: everyLanguage(DISALLOW) },
      { userAgent: AI_TRAINING_BOTS, disallow: "/" },
    ],
    // Each live language's own sitemap follows English's (src/app/[locale]/sitemap.xml; the index is /sitemap-index.xml).
    sitemap: [`${SITE_URL}/sitemap.xml`, ...LIVE_OTHER_LOCALES.map((l) => `${SITE_URL}/${l}/sitemap.xml`), ...cards.map(({ id }) => `${SITE_URL}/pokedex/tcg/sitemap/${id}.xml`)],
  };
}
