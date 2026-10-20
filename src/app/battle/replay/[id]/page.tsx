import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { ReplayViewer } from "@/components/battle/ReplayViewer";
import { REPLAY_ID_RE, replayResult } from "@/lib/battle/replay";
import { ReplaysUnavailable, replayStore } from "@/lib/server/battle-engine/replays";

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
  if (!replay) return pageMetadata({ title: "Battle replay", description: "A Pokémon battle replay on PokéIQ.", noindex: true });
  const title = `${replay.players[0]} vs ${replay.players[1]}: ${replay.formatName} replay`;
  return pageMetadata({
    title,
    socialTitle: title,
    description: `${replayResult(replay)} in ${replay.turns} turns. Watch the replay, turn by turn, on Pokémon Showdown's engine.`,
    path: `/battle/replay/${replay.id}`,
    noindex: !replay.public,
  });
}

export default async function ReplayPage({ params }: PageProps) {
  const replay = await findReplay((await params).id);
  if (!replay) notFound();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <BattleHeader crumb="Replay" title={`${replay.players[0]} vs`} accent={replay.players[1]}>
        {replay.ranked ? "Ranked · " : ""}
        {replay.formatName} · {replayResult(replay)} in {replay.turns} turn{replay.turns === 1 ? "" : "s"}.
      </BattleHeader>
      <ReplayViewer replay={replay} />
    </div>
  );
}
