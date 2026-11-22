import type { MetadataRoute } from "next";
import type { Locale } from "@/i18n/config";
import { localizePath } from "@/i18n/paths";
import { isPageIndexed, pageAlternates } from "@/i18n/routes";
import { SITE_URL } from "@/lib/site";

const pathOf = (url: string) => url.slice(SITE_URL.length) || "/";

/**
 * A sitemap's entries in `locale`: only the pages indexed in that language (served and not thin), at that language's URL, each with the
 * same hreflang set as the page's own <head> (src/i18n/routes.ts pageAlternates is the one source of both).
 * English entries stay exactly as they were while English is the only language.
 */
export function withAlternates(entries: MetadataRoute.Sitemap, locale: Locale): MetadataRoute.Sitemap {
  const out: MetadataRoute.Sitemap = [];
  for (const entry of entries) {
    const path = pathOf(entry.url);
    if (!isPageIndexed(path, locale)) continue;
    const alternates = pageAlternates(path);
    const languages = alternates && Object.fromEntries(Object.entries(alternates).map(([code, p]) => [code, `${SITE_URL}${p === "/" ? "" : p}`]));
    const url = `${SITE_URL}${localizePath(path, locale) === "/" ? "" : localizePath(path, locale)}`;
    out.push({ ...entry, url, ...(languages && { alternates: { languages } }) });
  }
  return out;
}

/** A sitemap in the protocol's XML, as Next writes app/sitemap.ts (with xhtml:link alternates). */
export function sitemapXml(entries: MetadataRoute.Sitemap): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rows = entries.map((e) => {
    const parts = [`<loc>${esc(e.url)}</loc>`];
    for (const [code, href] of Object.entries(e.alternates?.languages ?? {})) parts.push(`<xhtml:link rel="alternate" hreflang="${code}" href="${esc(String(href))}" />`);
    if (e.lastModified) parts.push(`<lastmod>${new Date(e.lastModified).toISOString()}</lastmod>`);
    if (e.changeFrequency) parts.push(`<changefreq>${e.changeFrequency}</changefreq>`);
    if (e.priority !== undefined) parts.push(`<priority>${e.priority}</priority>`);
    return `<url>\n${parts.join("\n")}\n</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join("\n")}\n</urlset>\n`;
}
