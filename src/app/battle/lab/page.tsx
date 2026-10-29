import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { BattleLab } from "@/components/battle/lab/BattleLab";

const DESCRIPTION =
  "Set up any two Pokémon teams, Gen 1 to 9, and run the battle thousands of times on Pokémon Showdown's own engine. See each side's win chance with a 95% confidence interval, how long battles last, who scores the KOs, and watch sample battles.";

export const metadata: Metadata = pageMetadata({
  title: "Battle Lab — Pokémon Win Probability Simulator",
  description: DESCRIPTION,
  path: "/battle/lab",
});

export default function LabPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <GameJsonLd name="Battle Lab" path="/battle/lab" description={DESCRIPTION} />
      <BattleHeader crumb="Battle Lab" title="Battle" accent="Lab">
        Set up two sides and let Pokémon Showdown&apos;s own engine play the battle thousands of times, right in your browser. See how often
        each side wins, how long it takes and what decides it.
      </BattleHeader>
      <BattleLab />
    </div>
  );
}
