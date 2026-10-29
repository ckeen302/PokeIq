import { SITE_URL, SITE_NAME } from "./site";
import { SITE_DESCRIPTION } from "./seo";

/** schema.org JSON-LD builders. Paths are site-relative ("/pokedex"); output URLs are absolute. */

const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path === "/" ? "" : path}`);

export interface Crumb {
  name: string;
  path: string;
}

/** BreadcrumbList, always starting at the home page. */
export function breadcrumbList(crumbs: Crumb[]) {
  const all = [{ name: SITE_NAME, path: "/" }, ...crumbs];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: all.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.path) })),
  };
}

/** The home page's WebSite node, with the sitelinks search box pointed at the TCG card search. */
export function websiteWithSearch() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/pokedex/tcg?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

/** A free browser game. */
export function webGame({ name, path, description }: { name: string; path: string; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name,
    url: abs(path),
    description,
    applicationCategory: "GameApplication",
    operatingSystem: "Any (web browser)",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}

/** An ordered list of pages (e.g. the Pokémon of one type). */
export function itemList(name: string, items: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, url: abs(it.path) })),
  };
}
