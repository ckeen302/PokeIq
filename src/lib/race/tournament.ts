/**
 * "Every Pokémon": a knockout tournament in the athletics format, computed
 * in one go. Pure and unit-tested (tests/race-tournament.test.ts).
 *
 * The field is drawn at random (a seeded shuffle, so a link always shows
 * the same draw) into heats of at most eight. Each round keeps about a
 * quarter of its runners, a multiple of eight: the first few in every heat
 * qualify by place (Q) and the rest of the places go to the fastest losers
 * across all heats (q), like the heats of a championship. The rounds
 * continue until eight are left for the final. Every runner's time is the
 * race model's, so a fast Pokémon can still go out in a strong heat.
 */

export interface Contender {
  key: string;
  time: number;
}

export interface HeatResult {
  key: string;
  time: number;
  place: number;
  /** "Q" by place, "q" as a fastest loser, null when out. */
  q: "Q" | "q" | null;
}

export interface Heat {
  index: number;
  results: HeatResult[];
}

export interface Round {
  name: string;
  /** How many go through: by place per heat, and fastest losers. */
  byPlace: number;
  byTime: number;
  heats: Heat[];
}

export interface Tournament {
  seed: number;
  rounds: Round[];
  /** The eight in the final, in seed order (fastest first). */
  finalists: string[];
  champion: string;
  /** How far each runner got: the index of the last round it ran (the final is the last round). */
  reached: Map<string, number>;
}

/** A small, fast, seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Splits n runners into the fewest heats of at most eight, as even as possible. */
export function heatSizes(n: number): number[] {
  const heats = Math.max(1, Math.ceil(n / 8));
  const base = Math.floor(n / heats), extra = n % heats;
  return Array.from({ length: heats }, (_, i) => base + (i < extra ? 1 : 0));
}

/** How many runners the next round takes: about a quarter, a multiple of eight, never fewer than eight. */
export function nextCount(n: number): number {
  return Math.max(8, Math.floor(n / 4 / 8) * 8);
}

const ROUND_NAMES = ["Final", "Semi-finals", "Quarter-finals", "Round 2", "Heats"];

const order = (a: Contender, b: Contender) => a.time - b.time || a.key.localeCompare(b.key);

export const DEFAULT_SEED = 2026;

export function knockout(field: Contender[], seed = DEFAULT_SEED): Tournament {
  if (field.length < 2) throw new Error("a tournament needs at least two runners");
  const rounds: Omit<Round, "name">[] = [];
  const reached = new Map<string, number>();
  let current = shuffle([...field].sort((a, b) => a.key.localeCompare(b.key)), seed);
  let r = 0;
  while (current.length > 8) {
    const sizes = heatSizes(current.length);
    const target = Math.min(current.length - 1, nextCount(current.length));
    const byPlace = Math.floor(target / sizes.length);
    const byTime = target - byPlace * sizes.length;
    const heats: Heat[] = [];
    let at = 0;
    for (let h = 0; h < sizes.length; h++) {
      const runners = current.slice(at, at + sizes[h]).sort(order);
      at += sizes[h];
      heats.push({ index: h, results: runners.map((c, k) => ({ key: c.key, time: c.time, place: k + 1, q: k < byPlace ? "Q" : null })) });
    }
    const losers = heats.flatMap((h) => h.results.filter((x) => !x.q)).sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
    for (const l of losers.slice(0, byTime)) l.q = "q";
    for (const c of current) reached.set(c.key, r);
    rounds.push({ byPlace, byTime, heats });
    // The next round is drawn again (a new shuffle of the qualifiers).
    const through = heats.flatMap((h) => h.results.filter((x) => x.q)).map((x) => ({ key: x.key, time: x.time }));
    current = shuffle(through.sort((a, b) => a.key.localeCompare(b.key)), seed + (r + 1) * 7919);
    r++;
  }
  const final = [...current].sort(order);
  for (const c of final) reached.set(c.key, r);
  rounds.push({ byPlace: 1, byTime: 0, heats: [{ index: 0, results: final.map((c, k) => ({ key: c.key, time: c.time, place: k + 1, q: k === 0 ? "Q" : null })) }] });
  const named: Round[] = rounds.map((x, i) => ({ ...x, name: ROUND_NAMES[Math.min(ROUND_NAMES.length - 1, rounds.length - 1 - i)] }));
  // With fewer rounds than names, the first round is still "Heats".
  if (named.length > 1) named[0].name = "Heats";
  return { seed, rounds: named, finalists: final.map((c) => c.key), champion: final[0].key, reached };
}

/** A runner's path: each round it ran, its heat and result. */
export function pathOf(t: Tournament, key: string): { round: Round; heat: Heat; result: HeatResult }[] {
  const out: { round: Round; heat: Heat; result: HeatResult }[] = [];
  for (const round of t.rounds) {
    for (const heat of round.heats) {
      const result = heat.results.find((x) => x.key === key);
      if (result) out.push({ round, heat, result });
    }
  }
  return out;
}
