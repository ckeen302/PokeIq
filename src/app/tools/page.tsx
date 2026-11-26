import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { getT } from "@/i18n/server";
import tools from "@/messages/tools";
import { hubData } from "@/components/tools/hub/data";
import { ToolsHub } from "@/components/tools/hub/ToolsHub";

/** /tools: the Tools tab: the Shiny Pokémon Maker, the Poké Ball Maker, the Pokémon Tier List Maker and the Favorite Pokémon Picker. */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(tools);
  return pageMetadata({ title: t("hub.metaTitle"), description: t("hub.metaDescription"), path: "/tools", image: { url: "/tools/shiny-maker/og", alt: t("maker.title") } });
}

export default async function ToolsPage() {
  return <ToolsHub data={await hubData()} />;
}
