import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { ABILITIES } from "@/lib/dex/data";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Abilities — Effects & Which Pokémon Have Them",
  description: "Browse every Pokémon ability with its in-battle effect, and see which Pokémon have it as a normal or hidden ability.",
  path: "/pokedex/abilities",
});

export default function AbilitiesPage() {
  const items = ABILITIES.map((a) => ({ slug: a.slug, name: a.name, effect: a.effect, count: a.holders.length }));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker={`Ability database · ${items.length.toLocaleString("en-US")} entries`}
        title="Poké"
        accent="dex"
        blurb={`All ${items.length.toLocaleString("en-US")} abilities — what they do and every Pokémon that has them.`}
      />
      <DexTabs active="abilities" />
      <DexListExplorer kind="abilities" items={items} />
    </div>
  );
}
