import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { PLACES } from "@/lib/dex/places-data";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Places — Towns, Routes, Caves & Gyms",
  description: "Every town, route, cave and Gym in every main-series Pokémon region: the wild Pokémon found there in each game, screenshots and Gym Leaders.",
  path: "/pokedex/places",
  image: SHARE_IMAGES.pokedex,
});

export default function PlacesPage() {
  const items = PLACES.map((p) => ({ slug: p.slug, name: p.name, region: p.region, type: p.type, ...(p.parent ? { parent: p.parent } : {}) }));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker="Place database"
        title="Poké"
        accent="dex"
        blurb={`Towns, routes, caves and buildings from every main-series region — the wild Pokémon in each game, plus the World Atlas screenshot and Gym Leaders where there are some.`}
      />
      <DexTabs active="places" />
      <DexListExplorer kind="places" items={items} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: "Pokédex", path: "/pokedex" }, { name: "Places", path: "/pokedex/places" }])) }} />
    </div>
  );
}
