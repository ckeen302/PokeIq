import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Connections } from "@/components/connections/Connections";
import { PuzzleOfTheDay } from "@/components/connections/PuzzleOfTheDay";
import { GameInfo } from "@/components/seo/GameInfo";
import { ConnectionsDuelCard } from "@/components/connections/ConnectionsDuelCard";
import { ConnectionsPartyCard } from "@/components/connections/ConnectionsParty";
import { ConnectionsRankedCard } from "@/components/connections/ConnectionsRanked";

export const metadata: Metadata = pageMetadata({
  title: "PokéConnections: the Daily Pokémon Connections Puzzle",
  description:
    "Pokémon Connections: sixteen Pokémon, four hidden groups: types, abilities, evolutions, stats and more. Find what links them with four mistakes to spare. A new puzzle every day, an archive and unlimited practice.",
  path: "/connections",
});

export default function ConnectionsPage() {
  // The tiles come from /api/connections once the player's local date is known; the groups never reach the page.
  return (
    <div className="space-y-10">
      <Connections />
      <PuzzleOfTheDay />
      <div id="duel" className="mx-auto max-w-3xl scroll-mt-24">
        <ConnectionsDuelCard />
      </div>
      <div id="ranked" className="mx-auto max-w-3xl scroll-mt-24">
        <ConnectionsRankedCard />
      </div>
      <div id="party" className="mx-auto max-w-3xl scroll-mt-24">
        <ConnectionsPartyCard />
      </div>
      <GameInfo
        path="/connections"
        name={`PokéConnections`}
        description={`PokéConnections is a free Pokémon Connections puzzle: sort sixteen Pokémon into four hidden groups with four mistakes to spare.`}
        intro={`PokéConnections is Pokémon Connections: sixteen Pokémon, four hidden groups, and a new puzzle every day.`}
        steps={[
          "Look at the sixteen Pokémon and find the ones that share something: a type, an ability, an evolution, stats and more.",
          "Select four and submit them as a group.",
          "You can make four mistakes before the puzzle ends.",
          "Play the daily puzzle, browse the archive or practice without limit.",
        ]}
        faqs={[
          { q: `What is PokéConnections?`, a: `A Pokémon version of the Connections puzzle: find the four hidden groups among sixteen Pokémon.` },
          { q: `What kinds of groups are there?`, a: `Types, abilities, evolutions, stats and more.` },
          { q: `How many mistakes can I make?`, a: `Four.` },
          { q: `Is there a new puzzle every day?`, a: `Yes, and there is also an archive and unlimited practice.` },
        ]}
      />
    </div>
  );
}
