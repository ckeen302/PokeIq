import lookalikeData from "@/data/lookalikes.json";
import { getPokemon, type Pokemon } from "./pokedex";

/**
 * Silhouette lookalikes from the offline DINOv2 embedding index
 * (scripts/silhouette-lookalikes.ts): nearest neighbours by cosine
 * similarity of silhouette embeddings. Server-side only.
 */

const LOOKALIKES = lookalikeData as unknown as Record<string, [number, number][]>;

export interface Lookalike {
  pokemon: Pokemon;
  /** Cosine similarity in [0, 1]. */
  similarity: number;
}

export function lookalikesOf(id: number, accept: (p: Pokemon) => boolean = () => true): Lookalike[] {
  return (LOOKALIKES[id] ?? [])
    .map(([other, score]) => ({ pokemon: getPokemon(other)!, similarity: score / 1000 }))
    .filter((l) => l.pokemon && accept(l.pokemon));
}
