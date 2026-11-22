import "server-only";
import { cache } from "react";
import { permanentRedirect as nextPermanentRedirect, redirect as nextRedirect, type RedirectType } from "next/navigation";
import { DEFAULT_LOCALE, isLiveLocale, type Locale } from "./config";
import { translator, type Namespace, type Translator, type Tree } from "./catalog";
import { localeHref } from "./href";
import { NAMESPACES } from "./namespaces";

/**
 * The language a server render is in. English pages never set it (they render exactly as before, statically);
 * every /<lang>/ entry point (its layout, each mirrored page and layout, their metadata) sets it from its params
 * before rendering, so server components below read it without any request headers or cookies.
 */
const store = cache((): { locale: Locale; messages: Record<string, Tree | undefined> | null } => ({ locale: DEFAULT_LOCALE, messages: null }));

export function setLocale(locale: string): void {
  store().locale = isLiveLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** Every namespace of a language, loaded once per language for the server's lifetime. */
const loaded = new Map<Locale, Promise<Record<string, Tree | undefined>>>();
function loadAll(locale: Locale): Promise<Record<string, Tree | undefined>> {
  let p = loaded.get(locale);
  if (!p) {
    p = Promise.all(NAMESPACES.map(async (name) => [name, await loadMessages(locale, name)] as const)).then(Object.fromEntries);
    loaded.set(locale, p);
  }
  return p;
}

/**
 * Sets the render's language and loads its messages, so server components below translate with `serverT` at once
 * (no await: an English page renders exactly as it did, and a translated one in the same order). Every /<lang>/ entry
 * point calls it first.
 */
export async function enterLocale(locale: string): Promise<void> {
  setLocale(locale);
  const l = store().locale;
  store().messages = l === DEFAULT_LOCALE ? null : await loadAll(l);
}

/** A namespace's translator in the render's language, synchronously (English, or a language entered with enterLocale). */
export function serverT<T extends Tree>(ns: Namespace<T>): Translator<T> {
  const { locale, messages } = store();
  if (locale === DEFAULT_LOCALE) return translator(ns, locale, undefined);
  if (!messages) throw new Error(`serverT(${ns.name}): the page's language (${locale}) was set without enterLocale`);
  return translator(ns, locale, messages[ns.name]);
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
