import type { Metadata } from "next";
import { Suspense } from "react";
import { pageMetadata } from "@/lib/seo";
import { getT } from "@/i18n/server";
import tools from "@/messages/tools";
import { hubData } from "@/components/tools/hub/data";
import { HUB_CSS } from "@/components/tools/hub/hub-css";
import { VariantA } from "@/components/tools/hub/VariantA";
import { VariantB } from "@/components/tools/hub/VariantB";
import { VariantC } from "@/components/tools/hub/VariantC";
import { VariantSwitch } from "@/components/tools/hub/VariantSwitch";

/** /tools: the Tools tab: the Shiny Pokémon Maker, the Poké Ball Maker, the Pokémon Tier List Maker and the Favorite Pokémon Picker. */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(tools);
  return pageMetadata({ title: t("hub.metaTitle"), description: t("hub.metaDescription"), path: "/tools", image: { url: "/tools/shiny-maker/og", alt: t("maker.title") } });
}

export default async function ToolsPage() {
  const data = await hubData();
  const a = <VariantA data={data} />;
  // MOCK ONLY: the other directions, on a development server (?v=b, ?v=c).
  const dev = process.env.NODE_ENV === "development";
  return (
    <>
      <Suspense fallback={a}>
        <VariantSwitch a={a} b={dev ? <VariantB data={data} /> : undefined} c={dev ? <VariantC data={data} /> : undefined} />
      </Suspense>
      <style>{HUB_CSS}</style>
    </>
  );
}
