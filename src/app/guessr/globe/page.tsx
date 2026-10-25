import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GlobeLoader } from "@/components/globe/GlobeLoader";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon World Globe: spin the whole Pokémon world in 3D",
  description:
    "A holographic 3D globe of the Pokémon world. Spin it, zoom from regions down to every town, route and landmark.",
  path: "/guessr/globe",
});

export default function GlobePage() {
  return <GlobeLoader />;
}
