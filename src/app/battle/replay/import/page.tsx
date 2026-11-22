import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { ReplayImport } from "@/components/battle/ReplayLists";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";
import battleReplays from "@/messages/battle-replays";
import battleReplayWords from "@/messages/battle-replay-words";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({
    title: t("import.title"),
    description: t("import.description"),
    path: "/battle/replay/import",
    image: SHARE_IMAGES.battle,
  });
}

export default function ReplayImportPage() {
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <BattleHeader back="/battle/replays" crumb={t("import.crumb")} title={t("import.heading")} accent={t("import.accent")}>
        {t("import.intro")}
      </BattleHeader>
      <ClientMessages namespaces={[battleReplays, battleReplayWords]}>
        <ReplayImport />
      </ClientMessages>
    </div>
  );
}
