import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { MOVES } from "@/lib/dex/data";
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
    title: t("moves.metaTitle"),
    description: t("moves.metaDescription"),
    path: "/pokedex/moves",
    image: SHARE_IMAGES.pokedex,
  });
}

export default function MovesPage() {
  const t = serverT(dexRef);
  const english = getLocale() === "en";
  const items = english ? MOVES.map((m) => ({ slug: m.slug, name: m.name, type: m.type, cls: m.cls, power: m.power, accuracy: m.accuracy, pp: m.pp })) : [];
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker={t("moves.kicker")}
        title={t("title")}
        accent={t("accent")}
        blurb={t("moves.blurb")}
      />
      <DexTabs active="moves" />
      <ClientMessages namespaces={[dexLists]}>
        {english ? <DexListExplorer kind="moves" items={items} /> : <LocalDexList kind="moves" />}
      </ClientMessages>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumb.pokedex"), path: "/pokedex" }, { name: t("crumb.moves"), path: "/pokedex/moves" }])) }} />
    </div>
  );
}
