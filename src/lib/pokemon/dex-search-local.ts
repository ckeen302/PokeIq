import { normalizeName } from "@/components/pokedle/search";

/**
 * The Pokédex list's search on a page in another language, loaded by the list only there (English pages keep
 * dex-search.ts alone): names and categories in that language, any script (kana fold to hiragana), plus each
 * Pokémon's other names the server sends (its English name and category; in Japanese, rōmaji).
 */

/** What the server sends the Pokédex list on a page in another language (English pages send none). */
export interface DexListLocal {
  /** Type id → the type's official name. */
  types: Record<string, string>;
  /** The regions of Generations 1–9, in order. */
  regions: string[];
  /** Pokédex number → its other names, each folded (normalizeName) and joined by spaces. */
  search: Record<number, string>;
}

export type LocalDexMatch = (p: { id: number; name: string; genus: string }, query: string, others: string | undefined) => boolean;

/** Whether a Pokémon matches what was typed: a number as in English, else its names and categories in any script. */
export const matchesLocalDexQuery: LocalDexMatch = (p, query, others) => {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) return String(p.id).startsWith(String(Number(trimmed)));
  const q = normalizeName(query);
  return !q || normalizeName(p.name).includes(q) || normalizeName(p.genus).includes(q) || (others?.includes(q) ?? false);
};
