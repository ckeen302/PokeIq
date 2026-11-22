import type { Metadata } from "next";
import { toRomaji } from "wanakana";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { PLACES } from "@/lib/dex/places-data";
import { dexNames } from "@/lib/dex/local-names";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import placesNs from "@/messages/places";
import dexRef from "@/messages/dex-ref";
import dexLists from "@/messages/dex-lists";
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
  const ref = serverT(dexRef);
  // Another language's page lists each place under its official name there, with the English one (and rōmaji in
  // Japanese) as search aliases; English pages send exactly what they did. Region and type stay English: they are the
  // filters' values (?region=Kanto links match them exactly).
  const names = dexNames();
  const en = names.locale === "en";
  const items = PLACES.map((p) => {
    const name = names.place(p.name);
    const aliases = en || name === p.name ? [] : [p.name, ...(names.locale === "ja" ? [toRomaji(name)] : [])];
    return { slug: p.slug, name, region: p.region, type: p.type, ...(p.parent ? { parent: names.place(p.parent) } : {}), ...(aliases.length ? { aliases } : {}) };
  });
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker={t("list.kicker")} title={ref("title")} accent={ref("accent")} blurb={t("list.blurb")} />
      <DexTabs active="places" />
      <ClientMessages namespaces={[dexLists]}>
        <DexListExplorer kind="places" items={items} />
      </ClientMessages>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumbs.pokedex"), path: "/pokedex" }, { name: t("crumbs.places"), path: "/pokedex/places" }])) }} />
    </div>
  );
}
