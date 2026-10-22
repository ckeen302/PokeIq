import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { PokedleWithCommunity } from "@/components/pokedle/PokedleCommunity";
import { PokedleDuelCard } from "@/components/pokedle/PokedleDuelCard";
import { RankedCard } from "@/components/pokedle/Ranked";

export const metadata: Metadata = pageMetadata({
  title: "Pokédle — Daily Pokémon Guessing Game",
  description:
    "Guess the mystery Pokémon in 8 tries. Each guess reveals clues about generation, type, height, weight, color and evolution stage. A new Pokémon every day, plus live duels against a friend or a stranger.",
  path: "/pokedle",
});

export default function PokedlePage() {
  // Only id + name + gen go to the client — enough for autocomplete, no answers.
  const names = POKEDEX.map((p) => [p.id, p.name, p.gen] as [number, string, number]);
  return (
    <div className="space-y-10">
      <PokedleWithCommunity names={names} />
      <div id="duel" className="scroll-mt-24 space-y-4">
        <div id="ranked" className="scroll-mt-24">
          <RankedCard />
        </div>
        <PokedleDuelCard />
      </div>
    </div>
  );
}
