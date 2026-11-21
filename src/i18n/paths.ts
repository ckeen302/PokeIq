import { DEFAULT_LOCALE, LIVE_OTHER_LOCALES, OTHER_LOCALES, type Locale, type OtherLocale } from "./config";

const PREFIX = new RegExp(`^/(${OTHER_LOCALES.join("|")})(?=/|$|\\?|#)`);

/**
 * A pathname's language and its English path: "/es/pokedle" → es, "/pokedle"; "/pokedle" → en, "/pokedle".
 * Only live languages count as a prefix (a page under a language that isn't live doesn't exist).
 */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const m = PREFIX.exec(pathname);
  if (!m || !(LIVE_OTHER_LOCALES as readonly string[]).includes(m[1])) return { locale: DEFAULT_LOCALE, path: pathname };
  const rest = pathname.slice(m[0].length);
  return { locale: m[1] as OtherLocale, path: rest === "" ? "/" : rest.startsWith("/") ? rest : `/${rest}` };
}

/** A pathname without its language prefix. */
export function stripLocale(pathname: string): string {
  return splitLocale(pathname).path;
}

/**
 * An English site path in another language: ("/pokedle", "es") → "/es/pokedle", ("/", "es") → "/es".
 * English paths come back unchanged. The query and hash are kept.
 */
export function localizePath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === "/") return `/${locale}`;
  if (path.startsWith("/?") || path.startsWith("/#")) return `/${locale}${path.slice(1)}`;
  return `/${locale}${path}`;
}

/**
 * An English site path for the address bar (history.replaceState) of the page being shown: in its language when it
 * has one ("/pokedex/sizes/pikachu" on /es/... → "/es/pokedex/sizes/pikachu"). Query-only and full URLs, and paths
 * already in a language, are left as they are; on an English page every path is.
 */
export function localUrl(path: string): string {
  if (typeof window === "undefined" || !path.startsWith("/") || path.startsWith("//")) return path;
  const { locale } = splitLocale(window.location.pathname);
  if (locale === DEFAULT_LOCALE || splitLocale(path).locale !== DEFAULT_LOCALE) return path;
  return localizePath(path, locale);
}
