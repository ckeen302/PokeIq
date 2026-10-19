import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GeoGame } from "@/components/geo/GeoGame";
import { geoRegions } from "@/lib/server/geo";

export const metadata: Metadata = pageMetadata({
  title: "PokéGuessr: GeoGuessr for Pokémon",
  description:
    "GeoGuessr for the Pokémon world. You're dropped somewhere from Kanto to Paldea: look at the in-game view, drop a pin on the map and score up to 25,000 points. New daily game every day.",
  path: "/guessr",
});

export default function GuessrPage() {
  return <GeoGame regions={geoRegions()} />;
}
