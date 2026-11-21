import { DEFAULT_LOCALE, type Locale } from "./config";

// i18n/paths as an English-only build has it (next.config swaps this file in while no other language is live):
// every path is an English path, and none of the language code reaches the browser.

export function splitLocale(pathname: string): { locale: Locale; path: string } {
  return { locale: DEFAULT_LOCALE, path: pathname };
}

export function stripLocale(pathname: string): string {
  return pathname;
}

export function localizePath(path: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE || !path.startsWith("/") || path.startsWith("//")) return path;
  if (path === "/") return `/${locale}`;
  if (path.startsWith("/?") || path.startsWith("/#")) return `/${locale}${path.slice(1)}`;
  return `/${locale}${path}`;
}

export function localUrl(path: string): string {
  return path;
}
