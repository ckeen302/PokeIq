/**
 * The guess box's suggestions: what you typed, forgiving accents,
 * punctuation and a typo or two. Pure, so it's tested on its own
 * (tests/pokedle-search.test.ts) and fast enough to run on every keystroke.
 */

export type NameEntry = [id: number, name: string, gen: number];

/** Lowercase letters and digits only: "Farfetch'd" → "farfetchd", "Flabébé" → "flabebe". */
export const normalizeName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/♀/g, "f")
    .replace(/♂/g, "m")
    .replace(/[^a-z0-9]/g, "");

/** Optimal string alignment distance (Levenshtein plus swapped neighbours), giving up past `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** How many typos a query of this length may have. */
const typosAllowed = (n: number) => (n < 4 ? 0 : n < 7 ? 1 : 2);

interface Indexed {
  entry: NameEntry;
  norm: string;
  /** Each word's start ("mr. mime" → "mrmime", "mime"). */
  words: string[];
}

const cache = new WeakMap<readonly NameEntry[], Indexed[]>();
function indexOf(names: readonly NameEntry[]): Indexed[] {
  let index = cache.get(names);
  if (!index) {
    index = names.map((entry) => {
      const parts = entry[1].split(/[\s\-.:]+/).filter(Boolean);
      return { entry, norm: normalizeName(entry[1]), words: parts.slice(1).map((_, i) => normalizeName(parts.slice(i + 1).join(""))) };
    });
    cache.set(names, index);
  }
  return index;
}

export interface Suggestions {
  entries: NameEntry[];
  /** The name typed is one already guessed (then there are no entries). */
  alreadyGuessed?: NameEntry;
}

/**
 * Up to `limit` Pokémon for `query`, best first: the exact name, then names
 * that start with it, then a later word that does ("mime" → Mr. Mime), then
 * names that contain it; and only when nothing matches what was typed,
 * near misses ("charzard", "gengr", "pikahcu").
 */
export function suggest(names: readonly NameEntry[], query: string, exclude: ReadonlySet<number>, limit = 7): Suggestions {
  const q = normalizeName(query);
  if (!q) return { entries: [] };
  const typed = query.trim().toLowerCase();
  const tiers: NameEntry[][] = [[], [], [], [], []];
  const fuzzy: [number, Indexed][] = [];
  let alreadyGuessed: NameEntry | undefined;
  for (const item of indexOf(names)) {
    const { entry, norm, words } = item;
    if (exclude.has(entry[0])) {
      if (norm === q) alreadyGuessed = entry;
      continue;
    }
    if (entry[1].toLowerCase() === typed) tiers[0].push(entry);
    else if (norm === q) tiers[1].push(entry);
    else if (norm.startsWith(q)) tiers[2].push(entry);
    else if (words.some((w) => w.startsWith(q))) tiers[3].push(entry);
    else if (norm.includes(q)) tiers[4].push(entry);
    else fuzzy.push([0, item]);
  }
  const found = tiers.flat();
  const max = typosAllowed(q.length);
  if (found.length === 0 && max > 0) {
    const near: [number, NameEntry][] = [];
    for (const [, { entry, norm }] of fuzzy) {
      // A typo in the name, or in the start of it typed so far.
      let d = editDistance(q, norm, max);
      for (let len = q.length - 1; len <= q.length + 1 && d > 0; len++) if (len > 0 && len < norm.length) d = Math.min(d, editDistance(q, norm.slice(0, len), max));
      if (d <= max) near.push([d, entry]);
    }
    near.sort((a, b) => a[0] - b[0] || a[1][1].length - b[1][1].length);
    found.push(...near.map(([, e]) => e));
  }
  // The exact name of a guess already made: say so, rather than offer near misses.
  if (alreadyGuessed && !tiers[0].length && !tiers[1].length) return { entries: [], alreadyGuessed };
  return { entries: found.slice(0, limit) };
}
