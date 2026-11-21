/**
 * Every message namespace (src/messages/<name>.ts), one per line: a page in another language loads that language's
 * files of all of them before it renders (src/i18n/server.ts), so its server components translate synchronously.
 * scripts/i18n/check-messages.mjs (npm run lint) keeps this list complete.
 */
export const NAMESPACES = [
  "api-errors",
  "common",
  "countdown",
  "credits",
  "duel",
  "error",
  "feedback",
  "game-info",
  "guessr-cards",
  "guessr-duel",
  "guessr-duel-page",
  "guessr-hud",
  "guessr-party",
  "guessr-ranked",
  "home",
  "howto",
  "nav",
  "pokedle",
  "pokedle-board",
  "pokedle-duel",
  "pokedle-game",
  "privacy",
  "report",
  "share",
  "share-page",
  "site",
  "tier",
] as const;
