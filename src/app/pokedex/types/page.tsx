import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList, itemList } from "@/lib/structured-data";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { TypeChart } from "@/components/pokedex/TypeChart";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";
import { getLocale, serverT } from "@/i18n/server";
import pages from "@/messages/pokedex-pages";
import { typeNames } from "@/lib/pokemon/dex-local";

export function generateMetadata(): Metadata {
  const t = serverT(pages);
  return pageMetadata({
    title: t("types.metaTitle"),
    description: t("types.metaDescription"),
    path: "/pokedex/types",
    image: SHARE_IMAGES.pokedex,
  });
}

export default function TypesPage() {
  const t = serverT(pages);
  const locale = getLocale();
  const names = locale === "en" ? null : typeNames(locale);
  const name = (type: string) => names?.[type] ?? capitalize(type);
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker={t("types.kicker")} title={t("titleStart")} accent={t("titleAccent")} blurb={t("types.blurb")} />
      <DexTabs active="types" />
      <TypeChart />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: t("crumbs.pokedex"), path: "/pokedex" }, { name: t("crumbs.types"), path: "/pokedex/types" }])) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(itemList(t("types.listName"), TYPES.map((ty) => ({ name: t("type.name", { type: name(ty) }), path: `/pokedex/types/${ty}` })))) }} />
    </div>
  );
}
