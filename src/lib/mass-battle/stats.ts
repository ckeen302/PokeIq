import type { BattleLevel, MBSpecies, StatTable } from "./types";

/**
 * The numbers each unit fights with. Battle stats use the games' stat
 * formula (Gen 3 onwards) with a neutral nature, 31 IVs and 85 EVs in every
 * stat (510 in all, the most a Pokémon can have); the damage calculator
 * gets the same spread, so its HP and ours agree.
 *
 * Bodies on the battlefield are our own addition: a footprint from the
 * Pokémon's height and the proportions of its HOME render, a mass from its
 * Pokédex weight, and a running speed scaled from base Speed with
 * 100 Speed = 10 m/s (Pokémon Race's convention).
 */

export const IV = 31;
export const EV = 85;
export const NATURE = "Hardy";

/** A battle stat at `level` (neutral nature). */
export function battleStat(key: keyof StatTable, base: number, level: number, shedinja = false): number {
  const core = Math.floor(((2 * base + IV + Math.floor(EV / 4)) * level) / 100);
  if (key === "hp") return shedinja ? 1 : core + level + 10;
  return core + 5;
}

export function battleStats(s: Pick<MBSpecies, "base" | "id">, level: BattleLevel): StatTable {
  const shed = s.id === 292;
  return {
    hp: battleStat("hp", s.base.hp, level, shed),
    atk: battleStat("atk", s.base.atk, level),
    def: battleStat("def", s.base.def, level),
    spa: battleStat("spa", s.base.spa, level),
    spd: battleStat("spd", s.base.spd, level),
    spe: battleStat("spe", s.base.spe, level),
  };
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
