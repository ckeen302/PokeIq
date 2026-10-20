import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { BattleHeader } from "@/components/battle/BattleHeader";
import { TournamentLobby } from "@/components/tournaments/TournamentLobby";

export const metadata: Metadata = pageMetadata({
  title: "Tournaments",
  description: "Pokémon battle tournaments on PokéIQ: single elimination or round robin in any format, plus an official Random Battle tournament every hour.",
  path: "/battle/tournaments",
});

export default function TournamentsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <BattleHeader crumb="Tournaments" title="Tournaments" accent="live">
        Join a bracket, or open your own in any format. An official Random Battle tournament starts every hour: sign-ups are open for the first ten minutes.
      </BattleHeader>
      <TournamentLobby />
    </div>
  );
}
