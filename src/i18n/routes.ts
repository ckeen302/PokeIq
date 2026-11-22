import { DEFAULT_LOCALE, LIVE_OTHER_LOCALES, type Locale, type OtherLocale } from "./config";
import { localizePath } from "./paths";

/**
 * Which pages exist in which language. A language is live (LIVE_LOCALES) and a page is translated into it
 * (TRANSLATED below): only then is the page served in that language, linked to from the other languages
 * (hreflang, sitemaps, the language picker) and indexed. Everything else under /<lang>/ is a 404, so a page
 * whose main content is still English is never published in another language.
 *
 * Patterns are English paths: "/pokedle" is that page, "/pokedle/**" also every page under it,
 * "/pokemon/*" one segment under /pokemon.
 */
/** Pages finished in every language: the site's own pages and, once done, each game. */
const ALL_LANGUAGES = ["/", "/privacy", "/credits", "/feedback", "/s/*", "/pokedle", "/pokedle/**", "/pokeguessr", "/pokeguessr/streak", "/pokeguessr/history/**", "/pokeguessr/r/*", "/pokeguessr/c/*", "/pokeguessr/duel/*", "/pokeguessr/party/*", "/pikadoku", "/pikadoku/**", "/pokeconnections", "/pokeconnections/**", "/quiz/name-em-all", "/quiz/name-em-all/**", "/login", "/login/**", "/users", "/rooms", "/rooms/*", "/trainer/avatar", "/quiz/which-pokemon", "/quiz/which-pokemon/**", "/quiz", "/quiz/whos-that-pokemon", "/quiz/pokemon-cry-quiz", "/quiz/pokedex-entry-quiz", "/quiz/pokemon-type-quiz", "/quiz/pokemon-higher-or-lower", "/quiz/pokemon-games-quiz", "/quiz/pokemon-ability-move-item-quiz", "/quiz/real-shiny-quiz", "/quiz/pokemon-zoom-quiz", "/quiz/pokemon-anime-quiz", "/quiz/whose-team-is-this", "/quiz/pokemon-trivia-quiz", "/quiz/gen-1-pokemon-quiz", "/quiz/gen-2-pokemon-quiz", "/quiz/gen-3-pokemon-quiz", "/quiz/gen-4-pokemon-quiz", "/quiz/gen-5-pokemon-quiz", "/quiz/gen-6-pokemon-quiz", "/quiz/gen-7-pokemon-quiz", "/quiz/gen-8-pokemon-quiz", "/quiz/gen-9-pokemon-quiz", "/quiz/duel/*", "/daily", "/c/*", "/iq-test", "/pokedex", "/pokedex/types", "/pokedex/types/*", "/pokedex/natures", "/pokedex/study", "/pokemon/*", "/pokedex/moves", "/pokedex/moves/*", "/pokedex/abilities", "/pokedex/abilities/*", "/pokedex/items", "/pokedex/items/*", "/pokedex/places", "/pokedex/places/*", "/pokedex/trainers", "/pokedex/trainers/**", "/atlas", "/pokeguessr/globe", "/pokedex/tcg", "/pokedex/tcg/**", "/pokedex/sizes", "/pokedex/sizes/**", "/pokedex/race", "/pokedex/race/**", "/pokedex/timeline", "/pokedex/timeline/*", "/lab/pokemon-story", "/lab/pokemon-story/*", "/lab/world-history", "/lab/world-history/*", "/pokedex/games", "/pokedex/games/*", "/pokedex/movies", "/pokedex/movies/*", "/pokedex/theories", "/pokedex/theories/*", "/lab", "/lab/games", "/lab/games/**", "/lab/mass-battle", "/lab/mass-battle/*", "/leaderboard", "/leaderboard/**", "/battle", "/battle/play", "/battle/tower", "/battle/factory", "/battle/teams", "/battle/calc", "/battle/ladder", "/battle/insights", "/battle/insights/*", "/battle/replays", "/battle/replay/*", "/battle/replay/import", "/battle/tournaments", "/battle/tournaments/*", "/trainer", "/u/*", "/email/confirm", "/email/unsubscribe", "/battle/play/*", "/battle/live/*", "/battle/watch", "/battle/lab", "/battle/player/*", "/lab/pokedex"];

export const TRANSLATED: Record<OtherLocale, readonly string[]> = {
  ja: ALL_LANGUAGES,
  es: ALL_LANGUAGES,
  fr: ALL_LANGUAGES,
  de: ALL_LANGUAGES,
  it: ALL_LANGUAGES,
};

/**
 * Pages served in a language but kept out of its search results (noindex, no hreflang, not in its sitemap): their
 * main content in that language is mostly names and numbers, or text that only exists in English (card text), so an
 * indexed copy would be a thin near-duplicate of the English page. KEEP_INDEXED lists exceptions to a pattern.
 */
const THIN_EVERYWHERE = ["/pokedex/tcg/*", "/pokedex/tcg/card/*", "/pokedex/sizes/*", "/pokedex/trainers/notable/*", "/lab/games/pokemon/*"];
/** Where a language's official place names cover well under half the places (es, it, ja), the per-place pages are thin too. */
const THIN_FEW_PLACE_NAMES = [...THIN_EVERYWHERE, "/pokedex/places/*", "/pokedex/trainers/*/*"];
export const UNINDEXED: Record<OtherLocale, readonly string[]> = {
  ja: THIN_FEW_PLACE_NAMES,
  es: THIN_FEW_PLACE_NAMES,
  fr: THIN_EVERYWHERE,
  de: THIN_EVERYWHERE,
  it: THIN_FEW_PLACE_NAMES,
};
/** The size lineups are real pages in every language (their own blurbs and captions), unlike the per-Pokémon ones. */
const KEEP_INDEXED = ["every-pokemon", "legendaries", "starters", "eeveelutions", "gen-1", "gigantamax", "bigger-than-a-house", "smaller-than-your-phone"].map(
  (id) => `/pokedex/sizes/${id}`
);

/**
 * Local review only: I18N_PREVIEW=1 serves every page in every live language, finished or not.
 * Ignored on Vercel's production deployment, so an untranslated page can never be published.
 */
const PREVIEW = process.env.I18N_PREVIEW === "1" && process.env.VERCEL_ENV !== "production";
// (next.config inlines I18N_PREVIEW for the browser too, already "" on Vercel's production, so both sides agree.)

function compile(pattern: string): RegExp {
  const body = pattern
    .split("/")
    .map((seg) => (seg === "**" ? "\u0000" : seg === "*" ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/")
    .replace("/\u0000", "(?:/.*)?");
  return new RegExp(`^${body}$`);
}

let compiled: Record<OtherLocale, RegExp[]> | null = null;
const patternsOf = (locale: OtherLocale) =>
  (compiled ??= Object.fromEntries(Object.entries(TRANSLATED).map(([l, patterns]) => [l, patterns.map(compile)])) as Record<OtherLocale, RegExp[]>)[locale];

/** Whether the page at this English path (no query) is served in this language. English pages always are. */
export function isPageLive(path: string, locale: Locale): boolean {
  if (locale === DEFAULT_LOCALE) return true;
  if (!process.env.LIVE_LOCALES) return false;
  if (!(LIVE_OTHER_LOCALES as readonly string[]).includes(locale)) return false;
  if (PREVIEW) return true;
  const clean = path.split(/[?#]/)[0] || "/";
  return patternsOf(locale as OtherLocale).some((re) => re.test(clean));
}

let thin: Record<OtherLocale, RegExp[]> | null = null;
const thinOf = (locale: OtherLocale) =>
  (thin ??= Object.fromEntries(Object.entries(UNINDEXED).map(([l, patterns]) => [l, patterns.map(compile)])) as Record<OtherLocale, RegExp[]>)[locale];

/** Whether the page at this English path is served in this language and meant for its search results (see UNINDEXED). */
export function isPageIndexed(path: string, locale: Locale): boolean {
  if (locale === DEFAULT_LOCALE) return true;
  if (!isPageLive(path, locale)) return false;
  const clean = path.split(/[?#]/)[0] || "/";
  if (KEEP_INDEXED.includes(clean)) return true;
  return !thinOf(locale as OtherLocale).some((re) => re.test(clean));
}

/** The languages the page at this English path is served in, English first. */
export function pageLocales(path: string): Locale[] {
  return [DEFAULT_LOCALE, ...LIVE_OTHER_LOCALES.filter((l) => isPageLive(path, l))];
}

/** The languages whose copy of this page is indexed (its hreflang set), English first. */
export function indexedLocales(path: string): Locale[] {
  return [DEFAULT_LOCALE, ...LIVE_OTHER_LOCALES.filter((l) => isPageIndexed(path, l))];
}

/** hreflang codes are the locale codes themselves (en, ja, es, fr, de, it). */
export type Alternates = Record<Locale | "x-default", string>;

/**
 * The one source of a page's language alternates, for its <head> and for the sitemaps alike:
 * every language it is indexed in (itself included) plus x-default, its own English URL.
 * Null when the page exists in English only (then nothing is emitted, as before languages existed).
 */
export function pageAlternates(path: string): Partial<Alternates> | null {
  const locales = indexedLocales(path);
  if (locales.length < 2) return null;
  const out: Partial<Alternates> = {};
  for (const l of locales) out[l] = localizePath(path, l);
  out["x-default"] = path;
  return out;
}
