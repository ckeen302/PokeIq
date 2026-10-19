import type { Metadata } from "next";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { TeamBuilder } from "@/components/battle/TeamBuilder";

export const metadata: Metadata = {
  title: "Pokémon Team Builder — Showdown Formats, Legality Checked",
  description:
    "Build competitive Pokémon teams for Gen 9 OU, Ubers, UU, Doubles OU, VGC, National Dex, Gen 4 OU and Gen 3 OU. Moves from each format's learnsets, live stats, Showdown import / export and Pokémon Showdown's own legality check.",
  alternates: { canonical: "/battle/teams" },
};

export default function TeamsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Team Builder" title="Team" accent="Builder">
        Six slots, every format&apos;s learnsets and Pokémon Showdown&apos;s own rules. Teams save on this device as you build, ready
        for battle.
      </BattleHeader>
      <TeamBuilder />
    </div>
  );
}
