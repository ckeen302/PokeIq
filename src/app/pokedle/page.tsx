import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { PokedleWithCommunity } from "@/components/pokedle/PokedleCommunity";
import { PokedleDuelCard } from "@/components/pokedle/PokedleDuelCard";
import { GameInfo } from "@/components/seo/GameInfo";
import { RankedCard } from "@/components/pokedle/Ranked";

export const metadata: Metadata = pageMetadata({
  title: "Pokédle: the Daily Pokémon Wordle Game",
  description:
    "Pokédle is the Pokémon Wordle: guess the mystery Pokémon in 8 tries. Each guess reveals clues about generation, type, height, weight, color and evolution stage. A new Pokémon every day, plus live duels against a friend or a stranger.",
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
      <GameInfo
        path="/pokedle"
        name={`Pokédle`}
        description={`Pokédle is a free daily Pokémon Wordle: guess the mystery Pokémon in 8 tries from clues about generation, type, height, weight, color and evolution stage.`}
        intro={`Pokédle is our Pokémon Wordle: one mystery Pokémon, eight guesses, and a new Pokémon every day.`}
        steps={[
          "Type the name of a Pokémon and submit it as your guess.",
          "Each guess shows how it compares with the mystery Pokémon: generation, type, height, weight, color and evolution stage.",
          "Use the clues to narrow it down and find the answer within 8 tries.",
          "Come back tomorrow for a new Pokémon, or challenge a friend or a stranger to a live duel.",
        ]}
        faqs={[
          { q: `What is Pokédle?`, a: `Pokédle is a Pokémon Wordle: a daily guessing game where each guess reveals clues about the mystery Pokémon.` },
          { q: `How many guesses do I get?`, a: `You have 8 tries to find the mystery Pokémon.` },
          { q: `What clues does each guess show?`, a: `Generation, type, height, weight, color and evolution stage, compared with the mystery Pokémon.` },
          { q: `How often does the Pokémon change?`, a: `A new Pokémon every day.` },
          { q: `Can I play against someone?`, a: `Yes. Pokédle has live duels against a friend through an invite link or against a stranger.` },
        ]}
      />
    </div>
  );
}
