import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Pikadoku } from "@/components/pikadoku/Pikadoku";
import { PikadokuDuelCard } from "@/components/pikadoku/PikadokuDuel";
import { GameInfo } from "@/components/seo/GameInfo";

export const metadata: Metadata = pageMetadata({
  title: "Pikadoku: the Daily Pokémon Sudoku and Pokémon Grid Game",
  description:
    "Pikadoku is Pokémon Sudoku, a free Pokémon grid game: fill a 3×3 grid with a Pokémon that fits each row and column. Easy, Normal and Expert dailies, a rarity score, unlimited grids and Tic Tac Toe duels.",
  path: "/pikadoku",
});

export default function PikadokuPage() {
  // The categories come from /api/pikadoku once the player's local date is known; the answers never reach the page.
  return (
    <div className="space-y-10">
      <Pikadoku />
      <div id="pdk-duel" className="mx-auto max-w-3xl scroll-mt-24">
        <PikadokuDuelCard />
      </div>
      <GameInfo
        howToButton
        path="/pikadoku"
        name="Pikadoku"
        description="Pikadoku is a free Pokémon Sudoku and Pokémon grid game: fill a 3×3 grid with a different Pokémon in each cell, matching both its row and its column."
        intro="Pikadoku is Pokémon Sudoku: a 3×3 Pokémon grid game with a new puzzle every day, in Easy, Normal and Expert."
        steps={[
          "Read the three row and three column categories: types, regions, evolution, moves, abilities, stats and more.",
          "Tap a cell and search for a Pokémon that fits both its row and its column. It locks in if it is right.",
          "You have 9 guesses (PP) in a daily, and a wrong guess still uses one. Each Pokémon can be used once.",
          "Your uniqueness score is the sum of the share of players who picked the same answers: lower is better.",
          "When the game ends, see every valid answer for every cell and why your misses did not fit.",
        ]}
        faqs={[
          { q: "How is the score worked out?", a: "It is the sum of the percentage of players who picked each of your answers in that cell, worked out by the server from recorded answers. Lower means rarer picks and a better score." },
          { q: "How do forms and regions count?", a: "Regional forms, Megas, Gigantamax forms and a few notable forms (like Partner Pikachu) are their own picks, with their own types, stats and abilities. A species' region is where it debuted; a regional form counts for the region it debuted in (Alolan Raichu is Alola), and Mega and Gigantamax forms count for their species' region. A form and its species are the same Pokémon, so only one of them can be used in a grid." },
          { q: "Is every grid solvable?", a: "Yes. Every daily is checked so each cell has enough valid answers and nine different Pokémon can fill the grid." },
          { q: "What are Easy, Normal and Expert?", a: "Easy uses broad categories with many answers, Normal is the main grid for the leaderboard, and Expert uses harder categories like moves, abilities and stat thresholds." },
        ]}
      />
    </div>
  );
}
