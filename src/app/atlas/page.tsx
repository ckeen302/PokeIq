import type { Metadata } from "next";
import { WorldAtlas } from "@/components/atlas/WorldAtlas";

export const metadata: Metadata = {
  title: "Pokémon World Atlas: every region on one map",
  description:
    "Every mainline Pokémon region from Kanto to Paldea on one zoomable world map, with every town, city, route and landmark labelled from the games' own maps.",
  alternates: { canonical: "/atlas" },
};

export default function AtlasPage() {
  return <WorldAtlas src="/geo/maps/world.webp" />;
}
