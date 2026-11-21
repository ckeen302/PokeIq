import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GeoGame } from "@/components/geo/GeoGame";
import { GameInfo } from "@/components/seo/GameInfo";
import { geoRegions } from "@/lib/server/geo";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pokeguessr from "@/messages/pokeguessr";
import { GEO_HUB_NAMESPACES } from "@/lib/geo-namespaces";

export function generateMetadata(): Metadata {
  const t = serverT(pokeguessr);
  return pageMetadata({
    title: t("hub.title"),
    description: t("hub.description"),
    path: "/pokeguessr",
  });
}

export default function GuessrPage() {
  const t = serverT(pokeguessr);
  return (
    <div className="space-y-10">
      <ClientMessages namespaces={GEO_HUB_NAMESPACES}>
        <GeoGame regions={geoRegions()} />
      </ClientMessages>
      <GameInfo
        path="/pokeguessr"
        noFaq
        name={`PokéGuessr`}
        howToButton
        description={t("hub.info.description")}
        intro={t("hub.info.intro")}
        steps={[t("hub.info.steps.look"), t("hub.info.steps.pin"), t("hub.info.steps.submit"), t("hub.info.steps.daily")]}
        faqs={[{ q: t("hub.info.faq.q"), a: t("hub.info.faq.a") }]}
      />
    </div>
  );
}
