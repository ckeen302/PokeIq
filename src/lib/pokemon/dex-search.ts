import { editDistance } from "@/components/pokedle/search";

/**
 * The Pokédex's search, shared by the Pokédex list and the home page's
 * search box: a number finds the National Dex numbers that start with it;
 * text finds names and categories ("Mouse Pokémon"), forgiving accents,
 * punctuation and case.
 */

/** [id, slug, name, category]: what /api/pokedex/names sends for the search box. */
export type DexSearchEntry = [id: number, slug: string, name: string, genus: string];

/** Lowercase letters and digits only: "Farfetch’d" → "farfetchd", "Flabébé" → "flabebe". */
export const normalizeDexQuery = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Whether a Pokémon matches what was typed (the Pokédex list's filter). */
export function matchesDexQuery(p: { id: number; name: string; genus: string }, query: string): boolean {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) return String(p.id).startsWith(String(Number(trimmed)));
  const q = normalizeDexQuery(query);
  return !q || normalizeDexQuery(p.name).includes(q) || normalizeDexQuery(p.genus).includes(q);
}

/** How many typos a query of this length may have. */
const typosAllowed = (n: number) => (n < 4 ? 0 : n < 7 ? 1 : 2);

/**
 * Up to `limit` Pokémon for a search box, best first. Numbers: the exact one,
 * then the others that start with it. Text: the exact name, names that start
 * with it, a later word that does ("mime" → Mr. Mime), names that contain it,
 * then categories that do; and only when nothing matches, near misses
 * ("pikahcu", "charzard").
 */
export function searchDex(entries: readonly DexSearchEntry[], query: string, limit = 6): DexSearchEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return entries
      .filter((e) => matchesDexQuery({ id: e[0], name: e[2], genus: e[3] }, trimmed))
      .sort((a, b) => (a[0] === n ? -1 : b[0] === n ? 1 : a[0] - b[0]))
      .slice(0, limit);
  }
  const q = normalizeDexQuery(trimmed);
  if (!q) return [];
  const tiers: DexSearchEntry[][] = [[], [], [], [], []];
  for (const e of entries) {
    const name = normalizeDexQuery(e[2]);
    const words = e[2].split(/[\s\-.:]+/).filter(Boolean).slice(1).map(normalizeDexQuery);
    if (name === q) tiers[0].push(e);
    else if (name.startsWith(q)) tiers[1].push(e);
    else if (words.some((w) => w.startsWith(q))) tiers[2].push(e);
    else if (name.includes(q)) tiers[3].push(e);
    else if (normalizeDexQuery(e[3]).includes(q)) tiers[4].push(e);
  }
  const found = tiers.flat();
  if (found.length) return found.slice(0, limit);
  const max = typosAllowed(q.length);
  if (!max) return [];
  return entries
    .map((e) => {
      const name = normalizeDexQuery(e[2]);
      // A typo in what's typed so far: compare with the name cut to the same length too.
      return { e, d: Math.min(editDistance(q, name, max), editDistance(q, name.slice(0, q.length), max)) };
    })
    .filter((x) => x.d <= max)
    .sort((a, b) => a.d - b.d || a.e[0] - b.e[0])
    .slice(0, limit)
    .map((x) => x.e);
}
