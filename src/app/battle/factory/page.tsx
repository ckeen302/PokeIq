import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GameJsonLd } from "@/components/seo/GameJsonLd";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { FrontierHub } from "@/components/battle/Frontier";

const DESCRIPTION =
  "The Battle Factory on Pokémon Showdown's engine: rent six Pokémon from Showdown's Battle Factory sets, win seven in a row against a computer that gets stronger, and trade for your opponent's Pokémon after every win.";

export const metadata: Metadata = pageMetadata({
  title: "Battle Factory — Rent a Team, Build a Streak",
  description: DESCRIPTION,
  path: "/battle/factory",
});

export default function BattleFactoryPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <GameJsonLd name="Battle Factory" path="/battle/factory" description={DESCRIPTION} />
      <BattleHeader crumb="Battle Factory" title="Battle" accent="Factory">
        No team needed: rent six Pokémon from Pokémon Showdown&apos;s Battle Factory sets, win seven in a row, and trade one of yours for one of your opponent&apos;s after
        every win. Or find an opponent who rents one too, from the battle setup.
      </BattleHeader>
      <FrontierHub mode="factory" />
    </div>
  );
}
