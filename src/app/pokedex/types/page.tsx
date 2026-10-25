import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { DexTabs } from "@/components/pokedex/DexTabs";
import { TypeChart } from "@/components/pokedex/TypeChart";
import { ListHeader } from "@/components/pokedex/detail/DetailParts";

export const metadata: Metadata = pageMetadata({
  title: "Pokémon Type Chart — Every Type Matchup",
  description: "The full 18-type Pokémon effectiveness chart: which attacking types are super effective, not very effective, or have no effect on each defending type.",
  path: "/pokedex/types",
});

export default function TypesPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <ListHeader kicker="Type chart · 18 types" title="Poké" accent="dex" blurb="Every attacking type against every defending type. For a dual-typed Pokémon, multiply the two columns." />
      <DexTabs active="types" />
      <TypeChart />
    </div>
  );
}
