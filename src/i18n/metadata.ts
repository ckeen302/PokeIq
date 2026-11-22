import type { Metadata } from "next";
import { DEFAULT_LOCALE, OG_LOCALES, type Locale } from "./config";
import { localizePath } from "./paths";
import { pageAlternates } from "./routes";

/** A page's hreflang links for Next's metadata (`alternates.languages`), or nothing while it exists in English only. */
export function languageAlternates(path: string): Record<string, string> | undefined {
  return pageAlternates(path) ?? undefined;
}

/**
 * A page's English metadata, as the same page in `locale`: the canonical and Open Graph URL point at the
 * language's own address (self-referencing), hreflang lists every language it is served in plus x-default,
 * and og:locale is the language's.
 */
export function localizeMetadata(meta: Metadata, locale: Locale): Metadata {
  if (locale === DEFAULT_LOCALE) return meta;
  const canonical = meta.alternates?.canonical;
  const path = typeof canonical === "string" ? canonical : undefined;
  const indexable = !isNoindex(meta);
  const out: Metadata = { ...meta };
  if (path !== undefined) {
    const languages = indexable ? languageAlternates(path) : undefined;
    out.alternates = { ...meta.alternates, canonical: localizePath(path, locale), ...(languages ? { languages } : { languages: undefined }) };
  }
  if (meta.openGraph) {
    const url = meta.openGraph.url;
    out.openGraph = { ...meta.openGraph, locale: OG_LOCALES[locale], ...(typeof url === "string" && { url: localizePath(url, locale) }) };
  }
  return out;
}

function isNoindex(meta: Metadata): boolean {
  const r = meta.robots;
  return typeof r === "object" && r !== null && "index" in r && r.index === false;
}
