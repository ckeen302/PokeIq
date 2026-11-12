import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { PokedexExplorer, type DexRow } from "@/components/pokedex/PokedexExplorer";
import { DexTabs } from "@/components/pokedex/DexTabs";
import Link from "@/components/ui/Link";
import { RANKINGS_PATH } from "@/lib/dex/rankings";

export const metadata: Metadata = pageMetadata({
  title: "Pokédex: Every Pokémon from Kanto to Paldea",
  description:
    "Browse and search every Pokémon from Kanto to Paldea. Filter by type and generation, sort by stats, and study evolutions, moves, abilities and weaknesses.",
  path: "/pokedex",
});

export default function PokedexPage() {
  const rows: DexRow[] = POKEDEX.map((p) => [
    p.id,
    p.slug,
    p.name,
    p.genus,
    p.types.join(" "),
    p.gen,
    p.stats.hp,
    p.stats.atk,
    p.stats.def,
    p.stats.spa,
    p.stats.spd,
    p.stats.spe,
    p.height,
    p.weight,
    (p.legendary ? 1 : 0) | (p.mythical ? 2 : 0) | (p.fullyEvolved ? 4 : 0),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="space-y-2 text-center">
        <p className="hud-label max-md:hidden text-screen">National database</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
          Poké<span className="text-primary">dex</span>
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Stats, evolutions, moves, abilities, matchups and every Pokédex entry. Study up, then test yourself.{" "}
          <Link href={RANKINGS_PATH} className="text-foreground underline underline-offset-2 hover:text-screen" data-testid="dex-rankings-link">
            Rankings
          </Link>
        </p>
      </div>
      <DexTabs active="pokemon" />
      <PokedexExplorer rows={rows} />
    </div>
  );
}
