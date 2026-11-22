import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import Link from "@/components/ui/Link";
import { FileUp, Radio } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ReplayLists } from "@/components/battle/ReplayLists";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";
import battleReplays from "@/messages/battle-replays";
import battleReplayWords from "@/messages/battle-replay-words";

export function generateMetadata(): Metadata {
  const t = serverT(battlePages);
  return pageMetadata({
    title: t("replays.title"),
    description: t("replays.description"),
    image: SHARE_IMAGES.battle,
    path: "/battle/replays",
  });
}

export default function ReplaysPage() {
  const t = serverT(battlePages);
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb={t("replays.crumb")} title={t("replays.heading")} accent={t("replays.accent")}>
        {t("replays.intro")}
      </BattleHeader>
      <div className="flex flex-wrap gap-2">
        <Link href="/battle/replay/import" className={buttonVariants({ variant: "outline" })} data-testid="replay-import-link">
          <FileUp className="h-4 w-4" aria-hidden /> {t("replays.import")}
        </Link>
        <Link href="/battle/watch" className={buttonVariants({ variant: "outline" })}>
          <Radio className="h-4 w-4" aria-hidden /> {t("replays.live")}
        </Link>
      </div>
      <ClientMessages namespaces={[battleReplays, battleReplayWords]}>
        <ReplayLists />
      </ClientMessages>
    </div>
  );
}
