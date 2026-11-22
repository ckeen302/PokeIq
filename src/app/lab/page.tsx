import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEMON_STORY_LIVE } from "@/lib/lab";
import { LabPage } from "@/components/lab/LabPage";

export const metadata: Metadata = pageMetadata({
  title: "3D Lab: Pokémon in cinematic 3D",
  description:
    `3D Lab: ${POKEMON_STORY_LIVE ? "watch the story of Pokémon as a 3D film" : "fly through Pokémon history in 3D"}, see every Pokémon at real size and spin the World Globe. Free, in your browser.`,
  path: "/lab",
  socialTitle: "3D Lab: Pokémon in cinematic 3D · PokéIQ",
});

export default function Page() {
  return <LabPage />;
}
