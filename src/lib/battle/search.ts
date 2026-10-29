/**
 * The team builder's search: one fuzzy matcher for Pokémon, moves, items and
 * abilities. Each list is indexed once (normalised names and word starts), so
 * a keystroke is one pass of cheap string checks over a few thousand entries.
 */

export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export interface SearchEntry<T> {
  item: T;
  /** "greattusk" */
  id: string;
  /** Word starts: "gt" for Great Tusk, "ut" for U-turn. */
  initials: string;
  /** Each word on its own: ["great", "tusk"]. */
  words: string[];
  /** Original position, the tie-break. */
  order: number;
}

export function buildIndex<T>(items: readonly T[], text: (item: T) => string): SearchEntry<T>[] {
  return items.map((item, order) => {
    const name = text(item);
    const words = name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return { item, id: normalize(name), initials: words.map((w) => w[0]).join(""), words, order };
  });
}

/**
 * How well `q` (already normalised) matches: lower is better, -1 for no match.
 * 0 exact, 1 prefix, 2 a later word's prefix, 3 initials, 4 substring,
 * 5 in-order letters (typo-tolerant "grtusk"), 6 one letter off.
 */
export function matchScore(entry: Pick<SearchEntry<unknown>, "id" | "initials" | "words">, q: string): number {
  const { id } = entry;
  if (!q) return 0;
  if (id === q) return 0;
  if (id.startsWith(q)) return 1;
  if (entry.words.some((w, i) => i > 0 && w.startsWith(q))) return 2;
  if (q.length >= 2 && entry.initials.startsWith(q)) return 3;
  if (id.includes(q)) return 4;
  if (q.length >= 3 && isSubsequence(q, id)) return 5;
  if (q.length >= 4 && oneEditPrefix(q, id)) return 6;
  return -1;
}

function isSubsequence(q: string, text: string): boolean {
  let j = 0;
  for (let i = 0; i < text.length && j < q.length; i++) if (text[i] === q[j]) j++;
  return j === q.length;
}

/** `q` is a prefix of `text` with one letter wrong, missing, extra or swapped ("garchopm", "drgapult"). */
function oneEditPrefix(q: string, text: string): boolean {
  const n = q.length;
  // One substitution or transposition, against the same length of text.
  const same = text.slice(0, n);
  if (same.length === n) {
    let diffs = 0;
    for (let i = 0; i < n && diffs < 3; i++) if (q[i] !== same[i]) diffs++;
    if (diffs === 1) return true;
    if (diffs === 2) {
      const i = [...q].findIndex((c, k) => c !== same[k]);
      if (q[i] === same[i + 1] && q[i + 1] === same[i]) return true;
    }
  }
  // One letter missing from q (text is longer by one) or one extra in q.
  return dropsTo(text.slice(0, n + 1), q) || (n > 1 && dropsTo(q, text.slice(0, n - 1)));
}

/** Removing one letter from `longer` gives `shorter`. */
function dropsTo(longer: string, shorter: string): boolean {
  if (longer.length !== shorter.length + 1) return false;
  let i = 0;
  while (i < shorter.length && longer[i] === shorter[i]) i++;
  return longer.slice(i + 1) === shorter.slice(i);
}

/**
 * Entries matching `query`, best first: by match quality, then `rank`
 * (lower first: usage order, say), then original order. No query keeps
 * the original order (or `rank`'s).
 */
export function search<T>(index: readonly SearchEntry<T>[], query: string, opts: { rank?: (item: T) => number; limit?: number; keep?: (item: T) => boolean } = {}): T[] {
  const q = normalize(query);
  const { rank, keep, limit = Infinity } = opts;
  const hits: { e: SearchEntry<T>; score: number; rank: number }[] = [];
  for (const e of index) {
    if (keep && !keep(e.item)) continue;
    const score = matchScore(e, q);
    if (score < 0) continue;
    hits.push({ e, score, rank: rank ? rank(e.item) : 0 });
  }
  hits.sort((a, b) => a.score - b.score || a.rank - b.rank || a.e.order - b.e.order);
  const out: T[] = [];
  for (const h of hits) {
    if (out.length >= limit) break;
    out.push(h.e.item);
  }
  return out;
}

/** A rank function from a most-used-first list of names: listed names by position, the rest after. */
export function usageRank(names: readonly string[] | undefined): ((name: string) => number) | undefined {
  if (!names?.length) return undefined;
  const pos = new Map(names.map((n, i) => [normalize(n), i]));
  return (name) => pos.get(normalize(name)) ?? names.length + 1;
}
