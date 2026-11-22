import "server-only";
import { cache } from "react";
import { permanentRedirect as nextPermanentRedirect, redirect as nextRedirect, type RedirectType } from "next/navigation";
import { DEFAULT_LOCALE, isLiveLocale, type Locale } from "./config";
import { translator, type Namespace, type Translator, type Tree } from "./catalog";
import { localeHref } from "./href";

/**
 * The language a server render is in. English pages never set it (they render exactly as before, statically);
 * every /<lang>/ entry point (its layout, each mirrored page and layout, their metadata) sets it from its params
 * before rendering, so server components below read it without any request headers or cookies.
 */
const store = cache((): { locale: Locale } => ({ locale: DEFAULT_LOCALE }));

export function setLocale(locale: string): void {
  store().locale = isLiveLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return store().locale;
}

/** A language's file of one namespace (server only; the browser gets it from <ClientMessages>). */
export async function loadMessages(locale: Locale, name: string): Promise<Tree | undefined> {
  if (locale === DEFAULT_LOCALE) return undefined;
  try {
    return (await import(`@/messages/${locale}/${name}.json`)).default as Tree;
  } catch {
    return undefined;
  }
}

/** A namespace's translator in the render's language (or the one given, e.g. for an image route). */
export async function getT<T extends Tree>(ns: Namespace<T>, locale: Locale = getLocale()): Promise<Translator<T>> {
  return translator(ns, locale, await loadMessages(locale, ns.name));
}

/** next/navigation's redirect, to the page's version in the render's language when it has one. */
export function redirect(href: string, type?: RedirectType): never {
  return nextRedirect(localeHref(href, getLocale()).href, type);
}

/** next/navigation's permanentRedirect, likewise kept in the render's language. */
export function permanentRedirect(href: string, type?: RedirectType): never {
  return nextPermanentRedirect(localeHref(href, getLocale()).href, type);
}
