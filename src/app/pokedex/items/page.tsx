import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { ITEMS } from "@/lib/dex/data";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { LocalDexList } from "@/components/pokedex/LocalDexList";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { ClientMessages } from "@/i18n/ClientMessages";
import { getLocale, serverT } from "@/i18n/server";
import dexRef from "@/messages/dex-ref";
import dexLists from "@/messages/dex-lists";

export function generateMetadata(): Metadata {
  const t = serverT(dexRef);
  return pageMetadata({
    title: t("items.metaTitle"),
    description: t("items.metaDescription"),
    path: "/pokedex/items",
    image: SHARE_IMAGES.pokedex,
  });
}

export default function ItemsPage() {
  const t = serverT(dexRef);
  const english = getLocale() === "en";
  const items = english ? ITEMS.map((i) => ({ slug: i.slug, name: i.name, category: i.category })) : [];
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker={t("items.kicker")}
        title={t("title")}
        accent={t("accent")}
        blurb={t("items.blurb")}
      />
      <DexTabs active="items" />
      <ClientMessages namespaces={[dexLists]}>
        {english ? <DexListExplorer kind="items" items={items} /> : <LocalDexList kind="items" />}
      </ClientMessages>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumb.pokedex"), path: "/pokedex" }, { name: t("crumb.items"), path: "/pokedex/items" }])) }} />
    </div>
  );
}
