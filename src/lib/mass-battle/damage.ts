import * as CalcLib from "@smogon/calc";
import type { Generation } from "@pkmn/data";
import { makePokemon, sideFromSet, type CalcModule } from "@/lib/battle/calc";
import type { TeamSet } from "@/lib/battle/sets";
import { EV, IV, NATURE } from "./stats";
import type { BattleLevel, MBMove, MBSpecies } from "./types";

/**
 * Damage, exactly as the games work it out: every number a hit can do comes
 * from Smogon's damage calculator (@smogon/calc, the one Showdown uses), so
 * STAB, the type chart, abilities (Huge Power, Levitate, Thick Fat…), items
 * and the 16 random rolls are the real ones. The Pokémon are built through
 * the site's own calculator glue (src/lib/battle/calc.ts).
 *
 * A battle has a few species but thousands of hits, so the table works each
 * (attacker, move, defender) out once and every hit after that is a lookup
 * plus a seeded roll. Entries are made on first use and kept. The few things
 * that change a hit mid-battle are part of the key: a critical hit, a spread
 * move hitting more than one foe (the 0.75 multiplier of the games' double
 * battles), and the HP-dependent cases (Flail and Reversal, Eruption and
 * Water Spout, Blaze-style abilities, Multiscale, Brine, Crush Grip).
 */

const GEN = CalcLib.Generations.get(9);
const CALC = { gen: GEN as unknown as Generation, lib: CalcLib as unknown as CalcModule };
const SINGLES = new CalcLib.Field({ gameType: "Singles" });
const DOUBLES = new CalcLib.Field({ gameType: "Doubles" });

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const PINCH: Record<string, string> = { blaze: "Fire", torrent: "Water", overgrow: "Grass", swarm: "Bug" };
const FULL_HP_SHIELDS = new Set(["multiscale", "shadowshield", "terashell"]);

/** The calculator's Pokémon for a species at a level, with the battle's spread (neutral nature, 31 IVs, 85 EVs). */
export function calcPokemon(s: MBSpecies, level: BattleLevel, moves: MBMove[]): CalcLib.Pokemon {
  const stats = (v: number) => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v });
  const set = {
    name: s.name,
    species: s.calc,
    item: s.item,
    ability: s.ability,
    moves: moves.map((m) => m.name),
    nature: NATURE,
    gender: "",
    evs: stats(EV),
    ivs: stats(IV),
    level,
  } as unknown as TeamSet;
  return makePokemon(CALC, sideFromSet(set)) as unknown as CalcLib.Pokemon;
}

/** How an attacker's HP changes its move: by the move's power, or by a pinch ability. */
function attackerKey(move: MBMove, ability: string, hp: number, max: number): number {
  const id = toId(move.name);
  if (id === "flail" || id === "reversal") {
    const r = Math.max(1, Math.floor((hp * 48) / max));
    return r < 2 ? 200 : r < 5 ? 150 : r < 10 ? 100 : r < 17 ? 80 : r < 33 ? 40 : 20;
  }
  if (id === "eruption" || id === "waterspout" || id === "dragonenergy") return Math.max(1, Math.floor((150 * hp) / max));
  const a = toId(ability);
  if (PINCH[a] === move.type) return hp <= Math.floor(max / 3) ? 1 : 0;
  if (a === "defeatist") return hp * 2 <= max ? 1 : 0;
  return 0;
}

/** How a defender's HP changes the hit: Multiscale at full HP, Brine at half, Crush Grip by the HP left. */
function defenderKey(move: MBMove, ability: string, hp: number, max: number): number {
  const id = toId(move.name);
  if (id === "crushgrip" || id === "wringout") return Math.max(1, Math.floor((120 * hp) / max));
  if (id === "hardpress") return Math.max(1, Math.floor((100 * hp) / max));
  if (id === "brine") return hp * 2 <= max ? 1 : 0;
  if (FULL_HP_SHIELDS.has(toId(ability))) return hp >= max ? 1 : 0;
  return 0;
}

/** A hit's possible damage: one array of the 16 rolls per hit (multi-hit moves have one per hit, most hits first worked out). */
export interface HitEntry {
  hits: Uint16Array[];
  /** Average damage of one hit (the first). */
  avg: number;
  /** Nothing gets through (a type immunity, Levitate, Water Absorb…). */
  immune: boolean;
}

export interface HitState {
  crit: boolean;
  spread: boolean;
  aHp: number;
  aMax: number;
  dHp: number;
  dMax: number;
}

const FULL = (aMax: number, dMax: number): HitState => ({ crit: false, spread: false, aHp: aMax, aMax, dHp: dMax, dMax });

/** Normalises the calculator's damage (a number, 16 rolls, or 16 rolls per hit) into per-hit roll arrays. */
export function rollsOf(damage: unknown): Uint16Array[] {
  const clamp = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));
  const sixteen = (v: number) => new Uint16Array(16).fill(clamp(v));
  if (typeof damage === "number") return [sixteen(damage)];
  if (!Array.isArray(damage) || damage.length === 0) return [sixteen(0)];
  if (typeof damage[0] === "number") {
    const arr = damage as number[];
    if (arr.length === 16) return [Uint16Array.from(arr, clamp)];
    // Fewer rolls (some fixed-damage results): spread them over the 16 slots.
    return [Uint16Array.from({ length: 16 }, (_, i) => clamp(arr[Math.min(arr.length - 1, Math.floor((i * arr.length) / 16))]))];
  }
  return (damage as unknown[]).map((h) => rollsOf(h)[0]);
}

export class DamageTable {
  readonly species: MBSpecies[];
  readonly moves: MBMove[][];
  readonly level: BattleLevel;
  private mons: CalcLib.Pokemon[];
  private calcMoves = new Map<string, CalcLib.Move>();
  private cache = new Map<number, HitEntry>();
  private canHit = new Map<number, boolean>();
  /** Calculations run so far (for profiling and tests). */
  calcs = 0;

  constructor(species: MBSpecies[], moves: MBMove[][], level: BattleLevel) {
    this.species = species;
    this.moves = moves;
    this.level = level;
    this.mons = species.map((s, i) => calcPokemon(s, level, moves[i]));
  }

  /** The calculator's HP for a species (the battle's own formula gives the same). */
  maxHp(sp: number): number {
    return this.mons[sp].maxHP();
  }

  private move(name: string, crit: boolean, hits: number): CalcLib.Move {
    const key = `${name}|${crit ? 1 : 0}|${hits}`;
    let m = this.calcMoves.get(key);
    if (!m) {
      m = new CalcLib.Move(GEN, name, { isCrit: crit, hits: hits > 1 ? hits : undefined });
      this.calcMoves.set(key, m);
    }
    return m;
  }

  /** The rolls of attacker species `a`'s move `slot` against species `d` in `state`. */
  entry(a: number, slot: number, d: number, state: HitState): HitEntry {
    const mv = this.moves[a][slot];
    const ak = attackerKey(mv, this.species[a].ability, state.aHp, state.aMax);
    const dk = defenderKey(mv, this.species[d].ability, state.dHp, state.dMax);
    const spread = state.spread && mv.spread;
    const S = this.species.length;
    const key = ((((a * S + d) * 4 + slot) * 2 + (state.crit ? 1 : 0)) * 2 + (spread ? 1 : 0)) * 65536 + ak * 256 + dk;
    let e = this.cache.get(key);
    if (e) return e;
    e = this.compute(a, mv, d, state, spread);
    this.cache.set(key, e);
    return e;
  }

  private compute(a: number, mv: MBMove, d: number, state: HitState, spread: boolean): HitEntry {
    this.calcs++;
    let atk = this.mons[a];
    let def = this.mons[d];
    if (state.aHp < state.aMax) {
      atk = atk.clone();
      atk.originalCurHP = Math.max(1, state.aHp);
    }
    if (state.dHp < state.dMax) {
      def = def.clone();
      def.originalCurHP = Math.max(1, state.dHp);
    }
    const hits = mv.hits ? mv.hits[1] : 1;
    try {
      const r = CalcLib.calculate(GEN, atk, def, this.move(mv.name, state.crit, hits), spread ? DOUBLES : SINGLES);
      const rolls = rollsOf(r.damage);
      const first = rolls[0];
      let sum = 0;
      for (let i = 0; i < 16; i++) sum += first[i];
      const immune = rolls.every((h) => h[15] === 0);
      return { hits: rolls, avg: sum / 16, immune };
    } catch {
      return { hits: [new Uint16Array(16)], avg: 0, immune: true };
    }
  }

  /** Whether any of `a`'s moves can hurt `d` at all. */
  canDamage(a: number, d: number): boolean {
    const key = a * 65536 + d;
    let ok = this.canHit.get(key);
    if (ok === undefined) {
      ok = false;
      const st = FULL(this.maxHp(a), this.maxHp(d));
      for (let s = 0; s < this.moves[a].length && !ok; s++) ok = !this.entry(a, s, d, st).immune;
      this.canHit.set(key, ok);
    }
    return ok;
  }

  /** Works out every full-HP entry between the two sides up front (so the first round doesn't wait on the calculator). */
  warm(sideA: number[], sideB: number[]) {
    for (const [att, defs] of [[sideA, sideB], [sideB, sideA]] as const) {
      for (const a of att) {
        for (const d of defs) {
          const st = FULL(this.maxHp(a), this.maxHp(d));
          for (let s = 0; s < this.moves[a].length; s++) {
            this.entry(a, s, d, st);
            if (this.moves[a][s].spread) this.entry(a, s, d, { ...st, spread: true });
          }
          this.canDamage(a, d);
        }
      }
    }
  }

  get size() {
    return this.cache.size;
  }
}
