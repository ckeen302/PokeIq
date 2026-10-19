import type { Metadata } from "next";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { PokedleWithCommunity } from "@/components/pokedle/PokedleCommunity";
import { PokedleDuelCard } from "@/components/pokedle/PokedleDuelCard";

export const metadata: Metadata = {
  title: "Pokédle — Daily Pokémon Guessing Game",
  description:
    "Guess the mystery Pokémon in 8 tries. Each guess reveals clues about generation, type, height, weight, color and evolution stage. New Pokémon every day.",
};

export default function PokedlePage() {
  // Only id + name + gen go to the client — enough for autocomplete, no answers.
  const names = POKEDEX.map((p) => [p.id, p.name, p.gen] as [number, string, number]);
  return (
    <div className="space-y-10">
      <PokedleWithCommunity names={names} />
      <div id="duel" className="mx-auto max-w-3xl scroll-mt-24">
        <PokedleDuelCard />
      </div>
    </div>
  );
}
