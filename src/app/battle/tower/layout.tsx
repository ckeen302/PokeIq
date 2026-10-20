import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";

export const metadata: Metadata = pageMetadata({
  title: "Battle Tower — Flat Rules Streaks vs the Computer",
  description:
    "The Battle Tower on Pokémon Showdown's engine: bring your team under Flat Rules (level 50, bring six, pick three) and build a streak against computer trainers, with the Tower Tycoon every seventh battle.",
  path: "/battle/tower",
});

export default function BattleTowerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <BattleHeader crumb="Battle Tower" title="Battle" accent="Tower">
        Your team, Flat Rules, and a streak of computer trainers that get tougher as you climb. Every seventh battle is the Tower Tycoon, with its best team.
      </BattleHeader>
      {children}
    </div>
  );
}
