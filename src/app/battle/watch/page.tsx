import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { serverT } from "@/i18n/server";
import { ClientMessages } from "@/i18n/ClientMessages";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { WatchLobby } from "@/components/battle/WatchLobby";
import pagesNs from "@/messages/battle-room-pages";
import watchNs from "@/messages/battle-watch";
import formatsNs from "@/messages/battle-formats";

export function generateMetadata(): Metadata {
  const t = serverT(pagesNs);
  return pageMetadata({
    title: t("watch.meta.title"),
    description: t("watch.meta.description"),
    image: SHARE_IMAGES.battle,
    path: "/battle/watch",
  });
}

export default function BattleWatchPage() {
  const t = serverT(pagesNs);
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb={t("watch.crumb")} title={t("watch.title")} accent={t("watch.accent")}>
        {t("watch.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[watchNs, formatsNs]}>
        <WatchLobby />
      </ClientMessages>
    </div>
  );
}
