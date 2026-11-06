import { figureSize, fromRow, type Entrant, type EntrantRow, type Stats } from "@/lib/race/types";
import { ARMED_SHAPES, BIPED_SHAPES, LOW_SHAPES, REF } from "./constants";

/**
 * An athlete of the PokéIQ Games: a Pokémon (or a form with its own stats)
 * from the Race's data (lib/race/data: base stats, height, weight, body
 * shape, types and the figure's render), plus what the events read that
 * the Race doesn't: egg groups (src/data/pokedex-details.json, the
 * species') and two abilities (Swift Swim, Levitate). Client-safe and
 * unit-tested.
 *
 * Sizes: `height` is the figure's standing height and `length` its
 * longest side, both from the Pokédex size and the HOME render's
 * proportions (lib/race/types' figureSize, the Race's and Sizes' rule: a
 * serpent or a fish wider than tall is measured along its length). So a
 * Wailord is 14.5 m long and as tall as its render shows.
 */

export type Body = "biped" | "quadruped" | "serpentine" | "other";

/** Trait bits (the compact wire format of /api/games). */
export const TRAIT = {
  /** Water 1, 2 or 3 egg group. */
  waterEgg: 1,
  /** Water 2: the fish egg group. */
  finEgg: 2,
  /** The Flying egg group (winged). */
  flyingEgg: 4,
  swiftSwim: 8,
  levitate: 16,
} as const;

export interface Athlete {
  key: string;
  name: string;
  /** The Race's entrant: the 3D figure, its gait and its render box. */
  entrant: Entrant;
  stats: Stats;
  kg: number;
  /** Standing height of the figure (m). */
  height: number;
  /** Longest side of the figure (m). */
  length: number;
  shape: string | null;
  types: string[];
  traits: number;
  body: Body;
  /** Has arms to throw with (body shape). */
  arms: boolean;
}

export type AthleteRow = [entrant: EntrantRow, traits: number];

export function bodyOf(shape: string | null): Body {
  if (shape && BIPED_SHAPES.has(shape)) return "biped";
  if (shape === "quadruped") return "quadruped";
  if (shape === "squiggle") return "serpentine";
  return "other";
}

export function toAthlete(e: Entrant, traits: number): Athlete {
  const { w, h } = figureSize(e);
  return {
    key: e.key,
    name: e.name,
    entrant: e,
    stats: e.stats,
    kg: e.kg,
    height: Math.max(0.05, h),
    length: Math.max(0.05, w, h),
    shape: e.shape,
    types: e.types,
    traits,
    body: bodyOf(e.shape),
    arms: !!e.shape && ARMED_SHAPES.has(e.shape),
  };
}

export const fromAthleteRow = ([row, traits]: AthleteRow): Athlete => toAthlete(fromRow(row), traits);

export const has = (a: Pick<Athlete, "traits">, bit: number) => (a.traits & bit) !== 0;

/** "Flies or floats": a Flying type, Levitate, or the Flying egg group (the high jump and long jump say so: gliding isn't allowed, it's a jump). */
export const isFlier = (a: Athlete) => a.types.includes("flying") || has(a, TRAIT.levitate) || has(a, TRAIT.flyingEgg);

/** Four legs or a serpent's body (the high jump's technique penalty). */
export const isLowBody = (a: Pick<Athlete, "shape">) => !!a.shape && LOW_SHAPES.has(a.shape);

/** The reference athlete the anchors are set on: 70 kg, 1.8 m tall, base 100 in every stat, a biped with arms, an elite human swimmer (aquatic factor 1). */
export function referenceAthlete(over: Partial<{ kg: number; height: number; stats: Partial<Stats>; shape: string; types: string[]; traits: number }> = {}): Athlete {
  const stats: Stats = { hp: REF.stat, atk: REF.stat, def: REF.stat, spa: REF.stat, spd: REF.stat, spe: REF.stat, ...over.stats };
  const height = over.height ?? REF.height;
  const shape = over.shape ?? "humanoid";
  const e: Entrant = {
    key: "reference",
    name: "Reference athlete",
    kind: "pokemon",
    species: 0,
    art: 0,
    stats,
    m: height,
    length: false,
    kg: over.kg ?? REF.kg,
    shape,
    types: over.types ?? ["normal"],
    motion: "run",
    gen: 0,
    legendary: false,
    mythical: false,
    chain: 0,
    evolved: true,
    box: [0, 0, 100, 100 * height, 512],
    depth: "sizes",
  };
  const a = toAthlete(e, over.traits ?? TRAIT.waterEgg);
  return { ...a, height, length: height };
}
