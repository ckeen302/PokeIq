import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { PLACES } from "@/lib/dex/places-data";
import { dexNames } from "@/lib/dex/local-names";
import { serverT } from "@/i18n/server";
import placesNs from "@/messages/places";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export function generateMetadata(): Metadata {
  const t = serverT(placesNs);
  return pageMetadata({
    title: t("meta.title"),
    description: t("meta.description"),
    path: "/pokedex/places",
    image: SHARE_IMAGES.pokedex,
  });
}

export default function PlacesPage() {
  const t = serverT(placesNs);
  // Another language's page lists each place under its official name there (English pages send exactly what they did).
  const names = dexNames();
  const items = PLACES.map((p) => ({ slug: p.slug, name: names.place(p.name), region: p.region, type: p.type, ...(p.parent ? { parent: names.place(p.parent) } : {}) }));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker={t("list.kicker")} title="Poké" accent="dex" blurb={t("list.blurb")} />
      <DexTabs active="places" />
      <DexListExplorer kind="places" items={items} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumbs.pokedex"), path: "/pokedex" }, { name: t("crumbs.places"), path: "/pokedex/places" }])) }} />
    </div>
  );
}
