import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { ReplayImport } from "@/components/battle/ReplayLists";

export const metadata: Metadata = pageMetadata({
  title: "Watch a Showdown Replay",
  description: "Paste a Pokémon Showdown battle log or open a saved replay file and watch it turn by turn.",
  path: "/battle/replay/import",
});

export default function ReplayImportPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <BattleHeader back="/battle/replays" crumb="Import" title="Watch a" accent="Showdown replay">
        Paste a battle log, or open a replay file Showdown saved, and play it back here.
      </BattleHeader>
      <ReplayImport />
    </div>
  );
}
