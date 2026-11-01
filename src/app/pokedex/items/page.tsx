import type { Metadata } from "next";
import { SHARE_IMAGES, pageMetadata } from "@/lib/seo";
import { ITEMS } from "@/lib/dex/data";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Items — Effects, Held Items & TMs",
  description: "Every item from the main Pokémon games: effects, categories, wild Pokémon that hold them, and the moves TMs, TRs and HMs teach.",
  path: "/pokedex/items",
  image: SHARE_IMAGES.pokedex,
});

export default function ItemsPage() {
  const items = ITEMS.map((i) => ({ slug: i.slug, name: i.name, category: i.category }));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker="Item database"
        title="Poké"
        accent="dex"
        blurb="Items from the main games: effects, who holds them in the wild, and which move each TM teaches."
      />
      <DexTabs active="items" />
      <DexListExplorer kind="items" items={items} />
    </div>
  );
}
