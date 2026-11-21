/**
 * Every message namespace (src/messages/<name>.ts), one per line: a page in another language loads that language's
 * files of all of them before it renders (src/i18n/server.ts), so its server components translate synchronously.
 * scripts/i18n/check-messages.mjs (npm run lint) keeps this list complete.
 */
export const NAMESPACES = [
  "common",
  "connections",
  "connections-board",
  "connections-cards",
  "connections-community",
  "connections-create",
  "connections-duel",
  "connections-groups",
  "connections-pages",
  "connections-party",
  "connections-stats",
  "countdown",
  "credits",
  "duel",
  "error",
  "feedback",
  "game-info",
  "home",
  "howto",
  "nav",
  "privacy",
  "report",
  "share",
  "share-page",
  "site",
  "tier",
] as const;
