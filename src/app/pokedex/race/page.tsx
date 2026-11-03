import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { RacePage } from "@/components/race/RacePage";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon race: which Pokémon is fastest? 3D sprint races",
  description:
    "Watch Pokémon race 100, 200 and 400 m in a 3D stadium at night, with speeds from their base stats and a sprint model from sports science: Regieleki against Shuckle, the fastest eight, a knockout of every Pokémon. Pick your own race, share it or make a video.",
  path: "/pokedex/race",
  socialTitle: "Which Pokémon is fastest? Watch them race · PokéIQ",
});

export default function Page() {
  return <RacePage />;
}
