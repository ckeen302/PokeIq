import { SITE_URL } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";
import type { Locale } from "@/i18n/config";
import { localizePath } from "@/i18n/paths";

/**
 * The Tier List Maker's structured data: a free web app, inside the Tools tab. On a page in another language the
 * names come in that language (`crumbs`: the Tools tab's and the maker's) and the addresses are the language's own.
 */
export function toolJsonLd({
  name,
  path,
  description,
  locale = "en",
  crumbs = { tools: "Tools", maker: "Pokémon Tier List Maker" },
}: {
  name: string;
  path: string;
  description: string;
  locale?: Locale;
  crumbs?: { tools: string; maker: string };
}) {
  const at = (p: string) => localizePath(p, locale);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name,
      url: `${SITE_URL}${at(path)}`,
      description,
      applicationCategory: "EntertainmentApplication",
      operatingSystem: "Any (web browser)",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: ["Tier list", "Bracket", "Top 10", "Blind ranking", "PNG download", "MP4 video download", "Share links"],
      ...(locale !== "en" && { inLanguage: locale }),
    },
    breadcrumbList([
      { name: crumbs.tools, path: at("/tools") },
      { name: crumbs.maker, path: at("/tools/tier-list") },
      ...(path !== "/tools/tier-list" ? [{ name, path: at(path) }] : []),
    ]),
  ];
}
