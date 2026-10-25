import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { PLACES } from "@/lib/dex/places-data";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Places — Towns, Routes, Caves & Gyms",
  description: "Every town, route, cave and Gym on the PokéIQ World Atlas: the wild Pokémon found there in each game, screenshots and Gym Leaders.",
  path: "/pokedex/places",
});

export default function PlacesPage() {
  const items = PLACES.map((p) => ({ slug: p.slug, name: p.name, region: p.region, type: p.type, ...(p.parent ? { parent: p.parent } : {}) }));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker={`Place database · ${items.length.toLocaleString("en-US")} entries`}
        title="Poké"
        accent="dex"
        blurb={`${items.length.toLocaleString("en-US")} towns, routes, caves and buildings from the World Atlas — the wild Pokémon in each game, a screenshot and the Gym Leaders.`}
      />
      <DexTabs active="places" />
      <DexListExplorer kind="places" items={items} />
    </div>
  );
}
