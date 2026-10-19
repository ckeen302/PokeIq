import type { Metadata } from "next";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { BattleSetup } from "@/components/battle/BattleSetup";

export const metadata: Metadata = {
  title: "Pokémon Battle — vs Computer or a Friend",
  description:
    "Real Pokémon battles on Pokémon Showdown's engine: Random Battle, Random Doubles or your own OU team, against a computer opponent or a friend through an invite link.",
  alternates: { canonical: "/battle/play" },
};

export default async function BattlePlayPage({ searchParams }: { searchParams: Promise<{ vs?: string }> }) {
  const { vs } = await searchParams;
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Play" title="Start a" accent="battle">
        Pokémon Showdown&apos;s own battle engine: every move, ability and item works as it does there. Pick an opponent, a format and go.
      </BattleHeader>
      <BattleSetup initial={vs === "friend" ? "pvp" : "cpu"} />
    </div>
  );
}
