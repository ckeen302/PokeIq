import { NATURES } from "./sets";
import type { MBSpecies, StatTable, UnitSet } from "./types";

/**
 * The numbers each unit fights with. Battle stats use the games' stat
 * formula (Gen 3 onwards) with the set's nature, EVs and IVs at its level
 * (by default a neutral nature, 31 IVs and 85 EVs in every stat, the
 * random battles' spread); the damage calculator gets the same set, so its
 * HP and ours agree.
 *
 * Bodies on the battlefield are our own addition: a footprint from the
 * Pokémon's height and the proportions of its HOME render, a mass from its
 * Pokédex weight, and a running speed scaled from base Speed with
 * 100 Speed = 10 m/s (Pokémon Race's convention).
 */

export const IV = 31;
export const EV = 85;
export const NATURE = "Hardy";

/** A battle stat at `level` (with a nature's 1.1 / 0.9 when it raises or lowers it). */
export function battleStat(key: keyof StatTable, base: number, level: number, shedinja = false, ev = EV, iv = IV, nature = 1): number {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (key === "hp") return shedinja ? 1 : core + level + 10;
  return Math.floor((core + 5) * nature);
}

const natureMul = (nature: string, key: keyof StatTable) => {
  const n = NATURES[nature];
  if (!n) return 1;
  return n[0] === key ? 1.1 : n[1] === key ? 0.9 : 1;
};

/** A species' stats with a set (or the random battles' spread at a level). */
export function battleStats(s: Pick<MBSpecies, "base" | "id">, set: Pick<UnitSet, "level" | "nature" | "evs" | "ivs"> | number): StatTable {
  const shed = s.id === 292;
  const st = typeof set === "number" ? { level: set, nature: NATURE, evs: { hp: EV, atk: EV, def: EV, spa: EV, spd: EV, spe: EV }, ivs: { hp: IV, atk: IV, def: IV, spa: IV, spd: IV, spe: IV } } : set;
  const one = (k: keyof StatTable) => battleStat(k, s.base[k], st.level, shed, st.evs[k], st.ivs[k], natureMul(st.nature, k));
  return { hp: one("hp"), atk: one("atk"), def: one("def"), spa: one("spa"), spd: one("spd"), spe: one("spe") };
}

/** m/s per point of base Speed (100 Speed = 10 m/s). */
export const SPEED_PER_POINT = 0.1;
/** Even the slowest Pokémon shuffles forward. */
export const MIN_RUN = 0.4;

export const runSpeed = (baseSpe: number) => Math.max(MIN_RUN, baseSpe * SPEED_PER_POINT);

/** Serpents and fish are measured along their length (as on Pokémon Sizes). */
export function isLength(shape: string | null, boxW: number, boxH: number): boolean {
  return (shape === "squiggle" || shape === "fish") && boxW > boxH;
}

/** The figure's world size (m): its documented height, or its length for long bodies. */
export function figureSize(s: Pick<MBSpecies, "m" | "shape" | "box">): { w: number; h: number } {
  const [, , bw, bh] = s.box;
  const a = bw / Math.max(1, bh);
  const m = Math.max(0.05, s.m);
  if (isLength(s.shape, bw, bh)) return a >= 1 ? { w: m, h: m / a } : { w: m * a, h: m };
  return { w: m * a, h: m };
}

/** Footprint radius (m) on the battlefield. */
export function bodyRadius(s: Pick<MBSpecies, "m" | "shape" | "box">): number {
  const { w } = figureSize(s);
  return Math.min(14, Math.max(0.12, w * 0.4));
}

/** Mass (kg) for pushing and knockback; a floor keeps feather-light Pokémon from flying off. */
export const bodyMass = (kg: number) => Math.max(1, kg);

/**
 * Forms an ability brings whose body isn't their species' size, by the damage calculator's name: PokéAPI's height
 * (m) and weight (kg) for the form and its HOME render's visible box, as src/data/race-forms.json has them (a unit
 * test checks they agree). Wishiwashi's School Form is a shoal 8.2 m long; the Solo Form is a 0.2 m fish. The other
 * forms (Aegislash's Blade Forme, Minior's core, Eiscue's Noice Face) are their species' own height.
 */
export const FORM_BODIES: Record<string, { m: number; kg: number; box: [number, number, number, number, number] }> = {
  "Wishiwashi-School": { m: 8.2, kg: 78.6, box: [11, 100, 491, 312, 512] },
};
