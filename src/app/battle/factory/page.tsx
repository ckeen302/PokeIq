import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { FrontierHub } from "@/components/battle/Frontier";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import pagesNs from "@/messages/battle-pages";
import frontierNs from "@/messages/battle-frontier";
import formatsNs from "@/messages/battle-formats";

export function generateMetadata(): Metadata {
  const t = serverT(pagesNs);
  return pageMetadata({
    title: t("factory.meta.title"),
    description: t("factory.description"),
    path: "/battle/factory",
    image: SHARE_IMAGES.battle,
  });
}

export default function BattleFactoryPage() {
  const t = serverT(pagesNs);
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <GameJsonLd name={t("factory.name")} path="/battle/factory" description={t("factory.description")} />
      <BattleHeader crumb={t("factory.name")} title={t("factory.title")} accent={t("factory.accent")}>
        {t("factory.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[frontierNs, formatsNs]}>
        <FrontierHub mode="factory" />
      </ClientMessages>
    </div>
  );
}
