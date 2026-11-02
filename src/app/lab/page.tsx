import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LabPage } from "@/components/lab/LabPage";

export const metadata: Metadata = pageMetadata({
  title: "3D Lab: Pokémon in cinematic 3D",
  description:
    "PokéIQ's 3D Lab: fly through Pokémon history in the 3D Timeline, see every Pokémon at its real size in Pokémon Sizes and make a video of it, and spin the whole Pokémon world on the World Globe. Free, in your browser.",
  path: "/lab",
  socialTitle: "3D Lab: Pokémon in cinematic 3D · PokéIQ",
});

export default function Page() {
  return <LabPage />;
}
