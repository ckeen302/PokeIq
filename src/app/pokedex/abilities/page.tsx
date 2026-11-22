import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { ABILITIES } from "@/lib/dex/data";
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
    title: t("abilities.metaTitle"),
    description: t("abilities.metaDescription"),
    path: "/pokedex/abilities",
    image: SHARE_IMAGES.pokedex,
  });
}

export default function AbilitiesPage() {
  const t = serverT(dexRef);
  const english = getLocale() === "en";
  const items = english ? ABILITIES.map((a) => ({ slug: a.slug, name: a.name, effect: a.effect, count: a.holders.length })) : [];
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker={t("abilities.kicker")}
        title={t("title")}
        accent={t("accent")}
        blurb={t("abilities.blurb")}
      />
      <DexTabs active="abilities" />
      <ClientMessages namespaces={[dexLists]}>
        {english ? <DexListExplorer kind="abilities" items={items} /> : <LocalDexList kind="abilities" />}
      </ClientMessages>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumb.pokedex"), path: "/pokedex" }, { name: t("crumb.abilities"), path: "/pokedex/abilities" }])) }} />
    </div>
  );
}
