import type { Metadata } from "next";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { DamageCalc } from "@/components/battle/DamageCalc";

export const metadata: Metadata = {
  title: "Pokémon Damage Calculator — Every Gen, Every Hit",
  description:
    "The Smogon damage calculator for Generations 3 to 9: damage ranges, KO chances and full descriptions with boosts, status, Tera, weather, terrain, screens and doubles spread. Load sets from your teams.",
  alternates: { canonical: "/battle/calc" },
};

export default function CalcPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Damage Calc" title="Damage" accent="Calc">
        Every move&apos;s damage range, KO chance and Showdown description, both ways. Powered by the Smogon damage calculator.
      </BattleHeader>
      <DamageCalc />
    </div>
  );
}
