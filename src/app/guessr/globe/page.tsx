import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { GlobeLoader } from "@/components/globe/GlobeLoader";
import { globeEras, globeRegionCards } from "@/lib/globe/regions";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon World Globe: spin the whole Pokémon world in 3D",
  description:
    "A holographic 3D globe of the Pokémon world. Spin it, zoom from regions down to every town, route and landmark, watch the world grow generation by generation, and see each town in a real screenshot.",
  path: "/guessr/globe",
});

export default function GlobePage() {
  const regions = globeRegionCards();
  return <GlobeLoader regions={regions} eras={globeEras(regions)} />;
}
