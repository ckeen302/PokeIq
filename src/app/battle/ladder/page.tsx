import type { Metadata } from "next";
import Link from "next/link";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { LadderTable, LadderTabs, YourBattleStanding } from "@/components/battle/LadderParts";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { isLadderFormat } from "@/lib/battle/ladder";
import { PLAY_FORMAT_INFO, type StandardFormatId } from "@/lib/battle/play";
import { GLICKO_START, GXE_RD_SHOWN } from "@/lib/battle/glicko";
import { ladderTop } from "@/lib/server/battle-engine/ladder";
import { avatarsByNames } from "@/lib/server/avatars";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Battle Ladder — Ranked Ratings by Format",
  description: "The ranked battle ladder: Glicko-2 ratings and GXE for Random Battle, Random Doubles, OU, Ubers, UU, RU, NU, PU, LC, Monotype, National Dex and Doubles OU, on Pokémon Showdown's engine.",
  image: SHARE_IMAGES.battle,
  path: "/battle/ladder",
});

export const dynamic = "force-dynamic";

export default async function LadderPage({ searchParams }: { searchParams: Promise<{ format?: string }> }) {
  const { format: raw } = await searchParams;
  const format: StandardFormatId = isLadderFormat(raw) ? raw : "gen9randombattle";
  const rows = await ladderTop(format);
  const avatars = await avatarsByNames((rows ?? []).map((r) => r.name));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BattleHeader crumb="Ladder" title="Battle" accent="ladder">
        One Glicko-2 rating per format, ranked by GXE (your chance of beating a random trainer on the ladder), as on Pokémon Showdown. Everyone starts at {GLICKO_START.rating} ± {GLICKO_START.rd}; a rating is provisional until its deviation drops below {GXE_RD_SHOWN}. A forfeit, running out the clock or leaving counts as a loss.
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
          <LadderTable rows={rows} format={format} avatars={avatars} />
        </>
      )}
    </div>
  );
}
