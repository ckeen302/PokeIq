import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GeoGame } from "@/components/geo/GeoGame";
import { GameInfo } from "@/components/seo/GameInfo";
import { geoRegions } from "@/lib/server/geo";

export const metadata: Metadata = pageMetadata({
  title: "PokéGuessr: the Pokémon GeoGuessr",
  description:
    "PokéGuessr is the Pokémon GeoGuessr. You're dropped somewhere from Kanto to Paldea: look at the in-game view, drop a pin on the map and score up to 25,000 points. New daily game every day.",
  path: "/guessr",
});

export default function GuessrPage() {
  return (
    <div className="space-y-10">
      <GeoGame regions={geoRegions()} />
      <GameInfo
        path="/guessr"
        name={`PokéGuessr`}
        description={`PokéGuessr is a free Pokémon GeoGuessr: look at an in-game view, drop a pin on the map of the Pokémon world and score up to 25,000 points.`}
        intro={`PokéGuessr is the Pokémon GeoGuessr: you are dropped somewhere in the Pokémon world, from Kanto to Paldea, and have to work out where.`}
        steps={[
          "Look at the in-game view you are given.",
          "Drop a pin on the map where you think it is.",
          "Submit your guess: the closer your pin, the more points you score, up to 25,000.",
          "A new daily game is available every day.",
        ]}
        faqs={[
          { q: `What is PokéGuessr?`, a: `PokéGuessr is a Pokémon GeoGuessr: guess where in the Pokémon world a view is from by placing a pin on the map.` },
          { q: `Which regions are included?`, a: `The Pokémon world from Kanto to Paldea.` },
          { q: `How is it scored?`, a: `The closer your pin is to the real location, the higher your score, up to 25,000 points.` },
          { q: `Is there a daily game?`, a: `Yes, a new daily game every day.` },
        ]}
      />
    </div>
  );
}
