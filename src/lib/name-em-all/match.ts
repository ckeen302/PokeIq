import type { NeaTarget } from "./types";

/**
 * Name 'em All's forgiving name matching. Case, accents, spaces and
 * punctuation never matter ("Mr. Mime", "mr mime" and "mrmime" are one
 * name), ♀/♂ read as f/m, and each form answers to the ways people write it
 * ("Mega Charizard X", "Charizard X", "Alolan Vulpix", "Vulpix Alola",
 * "Gmax Snorlax"). A matcher maps every accepted spelling to exactly one
 * slot of its category: a spelling two slots could claim equally is
 * dropped, so a bare "Charizard" names neither Mega.
 */

/** Lower-case letters and digits only: "Flabébé" -> "flabebe", "Type: Null" -> "typenull", "Nidoran♀" -> "nidoranf". */
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/♀/g, "f")
    .replace(/♂/g, "m")
    .replace(/[^a-z0-9]/g, "");
}

/** Extra spellings for a few species, by national number. */
const SPECIES_ALIASES: Record<number, string[]> = {
  29: ["nidoran female", "female nidoran", "nidoran f", "nidoran girl"],
  32: ["nidoran male", "male nidoran", "nidoran m", "nidoran boy"],
  83: ["farfetched"],
  865: ["sirfetched"],
};

const PREFIXES: Record<string, string[]> = {
  mega: ["mega"],
  gmax: ["gigantamax", "gmax"],
  alola: ["alolan", "alola"],
  galar: ["galarian", "galar"],
  hisui: ["hisuian", "hisui"],
  paldea: ["paldean", "paldea"],
};

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** Ways to write a form's qualifier: "combat breed" also as "combat"; "low key" as "lowkey". */
function qualifierVariants(q: string): string[] {
  const out = new Set([normalizeName(q)]);
  const words = q.split(" ");
  if (words.length > 1 && (words[words.length - 1] === "breed" || words[words.length - 1] === "form")) out.add(normalizeName(words.slice(0, -1).join(" ")));
  return [...out];
}

/**
 * Every spelling a slot answers to, each with a priority: 0 for its full
 * name in any word order, 1 for a shorter name that still says which form
 * (a default form without its qualifier, a form without its prefix), 2 for
 * the bare species name of a form. A spelling goes to the slot that claims
 * it with the lowest priority, and to nobody if two tie.
 */
export function targetSpellings(t: NeaTarget): { key: string; priority: number }[] {
  const out = new Map<string, number>();
  const add = (s: string, priority: number) => {
    const key = normalizeName(s);
    if (key && (!out.has(key) || out.get(key)! > priority)) out.set(key, priority);
  };
  add(t.name, 0);
  if (!t.form) {
    add(t.slug, 0);
    for (const a of SPECIES_ALIASES[t.species] ?? []) add(a, 0);
    return [...out].map(([key, priority]) => ({ key, priority }));
  }
  const { kind, base, region, qualifier, primary } = t.form;
  const prefixes = PREFIXES[kind === "regional" ? region ?? "" : kind] ?? [];
  const quals = qualifier ? qualifierVariants(qualifier) : [];
  const b = normalizeName(base);
  for (const p of prefixes) {
    if (quals.length) for (const q of quals) for (const order of permutations([p, b, q])) add(order.join(""), 0);
    else for (const order of permutations([p, b])) add(order.join(""), 0);
    if (primary) for (const order of permutations([p, b])) add(order.join(""), 1);
  }
  for (const q of quals) for (const order of permutations([b, q])) add(order.join(""), 1);
  add(base, 2);
  return [...out].map(([key, priority]) => ({ key, priority }));
}

export interface NeaMatcher {
  /** Accepted spelling (normalized) -> slot index. */
  keys: Map<string, number>;
  /** Each slot's accepted spellings, the full name first. */
  bySlot: string[][];
  /** Spellings no slot could claim alone. */
  dropped: string[];
}

export function buildMatcher(targets: readonly NeaTarget[]): NeaMatcher {
  const best = new Map<string, { priority: number; slots: number[] }>();
  targets.forEach((t, slot) => {
    for (const { key, priority } of targetSpellings(t)) {
      const cur = best.get(key);
      if (!cur || priority < cur.priority) best.set(key, { priority, slots: [slot] });
      else if (priority === cur.priority && !cur.slots.includes(slot)) cur.slots.push(slot);
    }
  });
  const keys = new Map<string, number>();
  const bySlot: string[][] = targets.map(() => []);
  const dropped: string[] = [];
  for (const [key, { slots }] of best) {
    if (slots.length === 1) {
      keys.set(key, slots[0]);
      bySlot[slots[0]].push(key);
    } else dropped.push(key);
  }
  targets.forEach((t, slot) => {
    const full = normalizeName(t.name);
    bySlot[slot].sort((a, b) => (a === full ? -1 : b === full ? 1 : a.length - b.length));
  });
  return { keys, bySlot, dropped };
}

/** The slot a typed name names, or undefined. */
export function matchName(m: NeaMatcher, input: string): number | undefined {
  const key = normalizeName(input);
  return key ? m.keys.get(key) : undefined;
}

/** True while what's typed could still grow into a name of one of `open` slots (so a shorter match keeps the text). */
export function couldGrow(m: NeaMatcher, typed: string, open: (slot: number) => boolean): boolean {
  const key = normalizeName(typed);
  if (!key) return false;
  for (const [k, slot] of m.keys) if (k.length > key.length && k.startsWith(key) && open(slot)) return true;
  return false;
}

/** Optimal string alignment distance (Levenshtein plus swapping two neighbours), stopping early past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev2 = new Array<number>(cols).fill(0);
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur = new Array<number>(cols);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

/** How far off a spelling may be for the helper to suggest it. */
export const spellingSlack = (length: number) => (length < 4 ? 0 : length < 7 ? 1 : 2);

/**
 * The spelling helper: the open slot whose name is closest to what's typed,
 * if it's close enough (one letter off for short names, two for long ones)
 * and the typing can't still grow into a real name.
 */
export function closestName(m: NeaMatcher, typed: string, open: (slot: number) => boolean): number | undefined {
  const key = normalizeName(typed);
  const slack = spellingSlack(key.length);
  if (!slack || m.keys.has(key) || couldGrow(m, typed, () => true)) return undefined;
  let bestSlot: number | undefined;
  let bestD = slack + 1;
  for (const [k, slot] of m.keys) {
    if (!open(slot)) continue;
    const d = editDistance(key, k, bestD - 1);
    if (d < bestD) {
      bestD = d;
      bestSlot = slot;
    }
  }
  return bestD <= slack ? bestSlot : undefined;
}
