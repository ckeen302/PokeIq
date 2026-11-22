import { SITE_URL } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";

/** The Tier List Maker's structured data: a free web app, inside the Tools tab. */
export function toolJsonLd({ name, path, description }: { name: string; path: string; description: string }) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name,
      url: `${SITE_URL}${path}`,
      description,
      applicationCategory: "EntertainmentApplication",
      operatingSystem: "Any (web browser)",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: ["Tier list", "Bracket", "Top 10", "Blind ranking", "PNG download", "MP4 video download", "Share links"],
    },
    breadcrumbList([
      { name: "Tools", path: "/tools" },
      { name: "Pokémon Tier List Maker", path: "/tools/tier-list" },
      ...(path !== "/tools/tier-list" ? [{ name, path }] : []),
    ]),
  ];
}
