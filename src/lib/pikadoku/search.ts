import { NOT_LETTERS, foldLetters } from "@/lib/names/fold";
/**
 * The picker's search: forgiving about accents, punctuation, spacing and a
 * typo or two, so "sirfetchd", "mr mime", "flabebe", "nidoran f", "charzard"
 * and "#25" all find their Pokémon. Client-safe and pure (tested).
 */

export interface SearchEntry {
  id: number;
  name: string;
  /** The species: equal to `id` for a species, else the form's species. */
  base: number;
  /**
   * In another language, the other names it also answers to: the English one, and for Japanese the rōmaji
   * ("Raichu de Alola" also answers to "Alolan Raichu"). English pages send none.
   */
  aliases?: readonly string[];
}

/** A name, normalized for matching. */
interface Spelling {
  /** Normalized words ("alolan raichu"). */
  words: string[];
  /** Normalized, without spaces ("alolanraichu"). */
  compact: string;
}

export interface Indexed<T extends SearchEntry> extends Spelling {
  entry: T;
  /** The other names it answers to, normalized (none on English pages). */
  alts: Spelling[];
}

/** Lower-case, no accents or punctuation, ♀/♂ as f/m, single spaces; any script (katakana as hiragana). */
export function normalizeName(s: string): string {
  return foldLetters(s.replace(/♀/g, " f").replace(/♂/g, " m"))
    .replace(NOT_LETTERS, " ")
    .trim();
}

/**
 * The entries as a page in another language names them (lib/pikadoku/local's `names`: id → its name there, then
 * other spellings), each also answering to its English name. Without names (English pages) they are returned as is.
 */
export function localizeEntries<T extends SearchEntry>(entries: T[], names: Readonly<Record<number, readonly string[]>> | undefined): T[] {
  if (!names) return entries;
  return entries.map((e) => {
    const own = names[e.id];
    if (!own) return e;
    const [name, ...rest] = own;
    return { ...e, name, aliases: [e.name, ...rest] };
  });
}

function spell(name: string): Spelling {
  const n = normalizeName(name);
  return { words: n.split(" "), compact: n.replace(/ /g, "") };
}

export function indexEntries<T extends SearchEntry>(entries: readonly T[]): Indexed<T>[] {
  return entries.map((entry) => ({ entry, ...spell(entry.name), alts: (entry.aliases ?? []).map(spell).filter((a) => a.compact) }));
}

/** Optimal-string-alignment distance (a swap of two neighbours costs one), capped at `max + 1`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Lower rank is better: an exact name, then the start of the name, the start
 * of a later word ("raichu" in "Alolan Raichu"), anywhere in the name, and last
 * a near miss (one typo, two in a longer query). Null: no match.
 */
export function rankEntry(x: Indexed<SearchEntry>, q: string, qc: string): number | null {
  if (!qc) return null;
  if (/^\d+$/.test(qc)) return x.entry.id === Number(qc) && x.entry.base === x.entry.id ? 0 : null;
  // In another language: the best of the name shown and the other names it answers to.
  let best = rankSpelling(x, q, qc);
  for (const a of x.alts) {
    if (best === 0) break;
    const r = rankSpelling(a, q, qc);
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

function rankSpelling(x: Spelling, q: string, qc: string): number | null {
  if (x.compact === qc) return 0;
  if (x.compact.startsWith(qc)) return 1;
  if (x.words.some((w, i) => i > 0 && w.startsWith(q.split(" ")[0]))) return 2;
  if (x.compact.includes(qc)) return 3;
  if (qc.length < 3) return null;
  const max = qc.length >= 6 ? 2 : 1;
  let best = max + 1;
  // Against the start of the name (a typo while still typing) and against each word.
  for (const len of [qc.length - 1, qc.length, qc.length + 1]) if (len > 0) best = Math.min(best, editDistance(qc, x.compact.slice(0, len), max));
  for (const w of x.words) best = Math.min(best, editDistance(qc, w, max));
  return best <= max ? 4 + best : null;
}

/** The best `limit` matches for a query, species before their forms on a tie, then shorter names. */
export function searchEntries<T extends SearchEntry>(index: readonly Indexed<T>[], query: string, limit = 8): T[] {
  const q = normalizeName(query.replace(/^#/, ""));
  const qc = q.replace(/ /g, "");
  if (!qc) return [];
  const hits: { x: Indexed<T>; r: number }[] = [];
  for (const x of index) {
    const r = rankEntry(x, q, qc);
    if (r !== null) hits.push({ x, r });
  }
  hits.sort((a, b) => a.r - b.r || Number(a.x.entry.id !== a.x.entry.base) - Number(b.x.entry.id !== b.x.entry.base) || a.x.compact.length - b.x.compact.length || a.x.entry.id - b.x.entry.id);
  return hits.slice(0, limit).map((h) => h.x.entry);
}
