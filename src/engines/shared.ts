import type { Rng } from "@/lib/rng";
import {
  GENERATION_REGIONS,
  evolutionFamily,
  poolFor,
  type Pokemon,
} from "@/lib/pokemon/pokedex";
import { capitalize } from "@/lib/pokemon/type-matrix";
import type { Difficulty, GenerateOptions } from "./types";

/**
 * Prior recognisability by generation on the PokéIQ rating scale.
 * These seed the item-difficulty model until enough real answers exist
 * to calibrate empirically (see supabase/migrations).
 */
const GEN_RATING: Record<number, number> = {
  1: 900, 2: 1060, 3: 1110, 4: 1130, 5: 1260, 6: 1230, 7: 1250, 8: 1260, 9: 1220,
};

export function genRating(p: Pokemon): number {
  let rating = GEN_RATING[p.gen] ?? 1250;
  if (p.legendary || p.mythical) rating -= 40; // box legends are memorable
  if (p.stage === 1 && !p.fullyEvolved) rating += 30; // pre-evolutions blur together
  return rating;
}

/**
 * Candidate pool for a difficulty. An explicit generation filter (e.g. the
 * "Gen 1 purist" mode) always wins; otherwise easy sticks to the classics.
 */
export function difficultyPool(opts: GenerateOptions): Pokemon[] {
  if (opts.gens && opts.gens.length > 0) return poolFor(opts.gens);
  const maxGen = { easy: 2, medium: 5, hard: 99 }[opts.difficulty];
  return poolFor().filter((p) => p.gen <= maxGen);
}

/** Pick an unused species and mark it used. */
export function pickTarget(
  rng: Rng,
  pool: readonly Pokemon[],
  used: Set<number>,
  filter: (p: Pokemon) => boolean = () => true
): Pokemon | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = rng.pick(pool);
    if (!used.has(p.id) && filter(p)) {
      used.add(p.id);
      return p;
    }
  }
  return null;
}

export type Similarity = "random" | "type" | "close";

export const SIMILARITY_BY_DIFFICULTY: Record<Difficulty, Similarity> = {
  easy: "random",
  medium: "type",
  hard: "close",
};

/**
 * Plausible wrong answers. "type" shares a type with the target; "close"
 * additionally prefers the same colour/shape/generation and allows
 * evolution-family members (Charmeleon vs Charizard silhouettes are
 * genuinely hard). Falls back to looser tiers so a question is never
 * starved of options.
 */
export function pickDistractors(
  rng: Rng,
  target: Pokemon,
  pool: readonly Pokemon[],
  count: number,
  similarity: Similarity,
  accept: (p: Pokemon) => boolean = () => true
): Pokemon[] {
  const family = new Set(evolutionFamily(target).map((p) => p.id));
  const base = pool.filter((p) => p.id !== target.id && accept(p));
  const nonFamily = base.filter((p) => !family.has(p.id));
  const sharesType = (p: Pokemon) => p.types.some((t) => target.types.includes(t));
  const closeness = (p: Pokemon) =>
    (sharesType(p) ? 2 : 0) +
    (p.color === target.color ? 1 : 0) +
    (p.shape === target.shape ? 1 : 0) +
    (p.gen === target.gen ? 1 : 0);

  const tiers: Pokemon[][] = [];
  if (similarity === "close") {
    const ranked = rng.shuffle(base).sort((a, b) => closeness(b) - closeness(a));
    tiers.push(ranked.slice(0, Math.max(count * 3, 8)));
  }
  if (similarity !== "random") tiers.push(nonFamily.filter(sharesType));
  tiers.push(nonFamily);

  const chosen: Pokemon[] = [];
  const names = new Set([target.name]);
  for (const tier of tiers) {
    for (const p of rng.shuffle(tier)) {
      if (chosen.length >= count) return chosen;
      if (!names.has(p.name)) {
        chosen.push(p);
        names.add(p.name);
      }
    }
  }
  return chosen;
}

export function typeLabel(p: Pokemon): string {
  return p.types.map(capitalize).join(" / ");
}

export function describe(p: Pokemon): string {
  const region = GENERATION_REGIONS[p.gen];
  return `It's ${p.name}, the ${p.genus} — ${typeLabel(p)} type from Gen ${p.gen}${region ? ` (${region})` : ""}.`;
}

export function clampRating(r: number): number {
  return Math.round(Math.min(2200, Math.max(600, r)));
}
