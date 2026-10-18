import type { Metadata } from "next";
import { GeoGame } from "@/components/geo/GeoGame";
import { geoRegions } from "@/lib/server/geo";

export const metadata: Metadata = {
  title: "PokéGuessr: GeoGuessr for Pokémon",
  description:
    "GeoGuessr for the Pokémon world. You're dropped somewhere in Kanto: look at the in-game view, drop a pin on the town map and score up to 25,000 points. New daily game every day.",
  alternates: { canonical: "/guessr" },
};

export default function GuessrPage() {
  const [kanto] = geoRegions();
  return <GeoGame region={kanto} />;
}
