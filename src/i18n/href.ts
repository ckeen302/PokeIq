import { DEFAULT_LOCALE, type Locale } from "./config";
import { localizePath } from "./paths";
import { isPageLive } from "./routes";

/**
 * Where an English site path goes from a page in `locale`: the same page in that language when it exists there,
 * else the English page. `external` is true when that leaves the language (it then needs a full page load).
 */
export function localeHref(href: string, locale: Locale): { href: string; external: boolean } {
  if (locale === DEFAULT_LOCALE || !href.startsWith("/") || href.startsWith("//")) return { href, external: false };
  if (isPageLive(href, locale)) return { href: localizePath(href, locale), external: false };
  return { href, external: true };
}
