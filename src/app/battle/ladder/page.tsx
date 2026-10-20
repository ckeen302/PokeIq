import type { Metadata } from "next";
import Link from "next/link";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { LadderTable, LadderTabs, YourBattleStanding } from "@/components/battle/LadderParts";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { isLadderFormat } from "@/lib/battle/ladder";
import { PLAY_FORMAT_INFO, type StandardFormatId } from "@/lib/battle/play";
import { RANKED_PROVISIONAL_GAMES, RANKED_START } from "@/lib/ranked";
import { ladderTop } from "@/lib/server/battle-engine/ladder";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Battle Ladder — Ranked Ratings by Format",
  description: "The ranked battle ladder: Elo ratings for Random Battle, Random Doubles, OU, UU, Ubers and Doubles OU, on Pokémon Showdown's engine.",
  image: SHARE_IMAGES.battle,
  path: "/battle/ladder",
});

export const dynamic = "force-dynamic";

export default async function LadderPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const { format: raw } = await searchParams;
  const format: StandardFormatId = isLadderFormat(raw) ? raw : "gen9randombattle";
  const rows = await ladderTop(format);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BattleHeader crumb="Ladder" title="Battle" accent="ladder">
        One rating per format. Everyone starts at {RANKED_START.toLocaleString("en-US")}; your first {RANKED_PROVISIONAL_GAMES} ranked games move it faster. A forfeit, running out the clock or leaving counts as a loss.
      </BattleHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LadderTabs format={format} hrefBase="/battle/ladder?format=" />
        <Link href="/battle/play?vs=anyone" className={buttonVariants({ size: "sm" })}>
          Play ranked
        </Link>
      </div>
      {rows === null ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Ranked battles open soon.</CardContent>
        </Card>
      ) : (
        <>
          <YourBattleStanding format={format} />
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">{PLAY_FORMAT_INFO[format].name}: top 100</h2>
          <LadderTable rows={rows} format={format} />
        </>
      )}
    </div>
  );
}
