import type { Metadata } from "next";
import { Suspense } from "react";
import { POKEDEX } from "@/lib/pokemon/pokedex";
import { censorEntry } from "@/engines/modules/dex";
import { StudyMode, type StudyCard } from "@/components/pokedex/StudyMode";

export const metadata: Metadata = {
  title: "Study Mode — Pokémon Flashcards",
  description: "Learn every Pokémon with flashcards: silhouettes, Pokédex entries and typings. Track what you've mastered, generation by generation.",
  alternates: { canonical: "/pokedex/study" },
};

export default function StudyPage() {
  const cards: StudyCard[] = POKEDEX.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    genus: p.genus,
    types: p.types,
    gen: p.gen,
    entry: p.flavor[0] ? censorEntry(p.flavor[0], p) : "",
  }));
  return (
    <Suspense>
      <StudyMode cards={cards} />
    </Suspense>
  );
}
