import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { MoreGames } from "@/components/seo/GameInfo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { TeamBuilder } from "@/components/battle/TeamBuilder";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Team Builder: Showdown Formats, Legality Checked",
  description:
    "A Pokémon team builder for competitive teams in Gen 9 OU, Ubers, UU, Doubles OU, VGC, National Dex, Gen 4 OU and Gen 3 OU. Moves from each format's learnsets, live stats, Showdown import / export and Pokémon Showdown's own legality check.",
  image: SHARE_IMAGES.battle,
  path: "/battle/teams",
});

export default function TeamsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Team Builder" title="Team" accent="Builder">
        A Pokémon team builder with six slots, every format&apos;s learnsets and Pokémon Showdown&apos;s own rules. Teams save on this device as you build, ready
        for battle.
      </BattleHeader>
      <TeamBuilder />
      <MoreGames />
    </div>
  );
}
