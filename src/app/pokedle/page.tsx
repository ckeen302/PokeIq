import type { Metadata } from "next";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { Pokedle } from "@/components/pokedle/Pokedle";

export const metadata: Metadata = {
  title: "Pokédle — Daily Pokémon Guessing Game",
  description:
    "Guess the mystery Pokémon in 8 tries. Each guess reveals clues about generation, type, height, weight, color and evolution stage. New Pokémon every day.",
};

export default function PokedlePage() {
  // Only id + name + gen go to the client — enough for autocomplete, no answers.
  const names = POKEDEX.map((p) => [p.id, p.name, p.gen] as [number, string, number]);
  return <Pokedle names={names} />;
}
