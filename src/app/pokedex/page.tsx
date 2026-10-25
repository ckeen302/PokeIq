import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { PokedexExplorer, type DexListItem } from "@/components/pokedex/PokedexExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";

export const metadata: Metadata = pageMetadata({
  title: "Pokédex — All 1,025 Pokémon",
  description:
    "Browse and search every Pokémon from Kanto to Paldea. Filter by type and generation, sort by stats, and study evolutions, moves, abilities and weaknesses.",
  path: "/pokedex",
});

export default function PokedexPage() {
  const items: DexListItem[] = POKEDEX.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    genus: p.genus,
    types: p.types,
    gen: p.gen,
    stats: p.stats,
    bst: p.bst,
    height: p.height,
    weight: p.weight,
    legendary: p.legendary,
    mythical: p.mythical,
    fullyEvolved: p.fullyEvolved,
  }));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">National database · {items.length.toLocaleString("en-US")} entries</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Poké<span className="text-primary">dex</span>
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          All {items.length.toLocaleString("en-US")} Pokémon — stats, evolutions, moves, abilities, matchups and every Pokédex
          entry. Study up, then test yourself.
        </p>
      </div>
      <DexTabs active="pokemon" />
      <PokedexExplorer items={items} />
    </div>
  );
}
