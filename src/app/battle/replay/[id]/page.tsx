import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { ReplayViewer } from "@/components/battle/ReplayViewer";
import { REPLAY_ID_RE, replayMatchup, replayResult, replayTitle } from "@/lib/battle/replay";
import { ReplaysUnavailable, replayStore } from "@/lib/server/battle-engine/replays";
import { ClientMessages } from "@/i18n/ClientMessages";
import { serverT } from "@/i18n/server";
import battlePages from "@/messages/battle-tools-pages";
import battleReplayWords from "@/messages/battle-replay-words";
import battleReplays from "@/messages/battle-replays";
import battleAnalysis from "@/messages/battle-analysis";
import battlePlay from "@/messages/battle-play";
import battleTooltips from "@/messages/battle-tooltips";
import battleRoom from "@/messages/battle-room";
import battleFormatsNs from "@/messages/battle-formats";
import shareNs from "@/messages/share";
import battleLabCharts from "@/messages/battle-lab-charts";
import battleInputs from "@/messages/battle-inputs";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

/** One read for the metadata and the page; null if there's no such replay (or replays are off). */
const findReplay = cache(async (id: string) => {
  if (!REPLAY_ID_RE.test(id)) return null;
  try {
    return (await replayStore()?.get(id)) ?? null;
  } catch (err) {
    if (!(err instanceof ReplaysUnavailable)) console.error("[replay] read failed:", err);
    return null;
  }
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const replay = await findReplay((await params).id);
  const t = serverT(battlePages);
  if (!replay) return pageMetadata({ title: t("replay.fallbackTitle"), description: t("replay.fallbackDescription"), noindex: true });
  const w = serverT(battleReplayWords);
  const title = t("replay.title", { title: replayTitle(replay, w), format: replay.formatName });
  return pageMetadata({
    title,
    socialTitle: title,
    description: t("replay.description", { result: replayResult(replay, w), turns: replay.turns }),
    path: `/battle/replay/${replay.id}`,
    noindex: !replay.public,
  });
}

export default async function ReplayPage({ params }: PageProps) {
  const replay = await findReplay((await params).id);
  if (!replay) notFound();
  const t = serverT(battlePages);
  const w = serverT(battleReplayWords);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <BattleHeader back="/battle/replays" crumb={t("replay.crumb")} title={`${replayMatchup(replay).a} ${w(`joiner.${replayMatchup(replay).joiner}`)} `} accent={replayMatchup(replay).b}>
        {replay.ranked ? t("replay.ranked") : ""}
        {t("replay.summary", { format: replay.formatName, result: replayResult(replay, w), turns: replay.turns })}
      </BattleHeader>
      <ClientMessages namespaces={[battleReplays, battleReplayWords, battleAnalysis, battlePlay, battleTooltips, battleRoom, battleFormatsNs, shareNs, battleLabCharts, battleInputs]}>
        <ReplayViewer replay={replay} />
      </ClientMessages>
    </div>
  );
}
