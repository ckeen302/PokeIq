import type { Metadata } from "next";
import { SHARE_IMAGES, jsonLd, pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { ABILITIES } from "@/lib/dex/data";
import { DexListExplorer } from "@/components/pokedex/DexListExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Abilities — Effects & Which Pokémon Have Them",
  description: "Browse every Pokémon ability with its in-battle effect, and see which Pokémon have it as a normal or hidden ability.",
  path: "/pokedex/abilities",
  image: SHARE_IMAGES.pokedex,
});

export default function AbilitiesPage() {
  const items = ABILITIES.map((a) => ({ slug: a.slug, name: a.name, effect: a.effect, count: a.holders.length }));
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader
        kicker="Ability database"
        title="Poké"
        accent="dex"
        blurb="What each ability does and every Pokémon that has it."
      />
      <DexTabs active="abilities" />
      <DexListExplorer kind="abilities" items={items} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbList([{ name: "Pokédex", path: "/pokedex" }, { name: "Abilities", path: "/pokedex/abilities" }])) }} />
    </div>
  );
}
