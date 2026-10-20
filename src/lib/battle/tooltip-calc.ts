import type { Generation } from "@pkmn/data";
import { calcMoves, emptySide, type BoostKey, type CalcField, type CalcLine, type CalcModule, type CalcSide, type StatusId } from "./calc";
import type { StatsTable } from "./sets";

/**
 * The battle screen's tooltips: a move's damage range against the Pokémon
 * in front of you, worked out by the Smogon damage calculator (@smogon/calc)
 * on the battle's own generation, weather, terrain, screens and boosts, and
 * a Pokémon's possible stats.
 *
 * Your own Pokémon's stats are exact (the simulator's request lists them):
 * the spread (nature, EVs, IVs) that gives exactly those stats is found and
 * handed to the calculator, so it computes from the very same numbers. A
 * foe's spread isn't known: random battles use their fixed spread (84 EVs
 * and 31 IVs in every stat, a neutral nature); other formats assume none
 * (0 EVs, a neutral nature), as the calculator's own description says.
 */

/** What a random battle's Pokémon may have (GET /api/battle/randsets). */
export interface RandSetsInfo {
  level: number | null;
  abilities: string[];
  items: string[];
  moves: string[];
  teraTypes: string[];
}

type StatId = keyof StatsTable;
const STATS: StatId[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** The 25 natures: [name, raised stat, lowered stat] (the neutral ones raise and lower nothing). */
export const NATURES: [string, Exclude<StatId, "hp"> | null, Exclude<StatId, "hp"> | null][] = [
  ["Hardy", null, null],
  ["Lonely", "atk", "def"],
  ["Brave", "atk", "spe"],
  ["Adamant", "atk", "spa"],
  ["Naughty", "atk", "spd"],
  ["Bold", "def", "atk"],
  ["Relaxed", "def", "spe"],
  ["Impish", "def", "spa"],
  ["Lax", "def", "spd"],
  ["Timid", "spe", "atk"],
  ["Hasty", "spe", "def"],
  ["Jolly", "spe", "spa"],
  ["Naive", "spe", "spd"],
  ["Modest", "spa", "atk"],
  ["Mild", "spa", "def"],
  ["Quiet", "spa", "spe"],
  ["Rash", "spa", "spd"],
  ["Calm", "spd", "atk"],
  ["Gentle", "spd", "def"],
  ["Sassy", "spd", "spe"],
  ["Careful", "spd", "spa"],
];

/** A stat from Gen 3 on (Shedinja's 1 HP aside). */
export function calcStat(stat: StatId, base: number, level: number, iv: number, ev: number, nature = 1): number {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (stat === "hp") return base === 1 ? 1 : core + level + 10;
  return Math.floor((core + 5) * nature);
}

/** The lowest and highest a stat can be at `level` (0 IVs and EVs with a hindering nature, to 31 and 252 with a helpful one). */
export function statRange(stat: StatId, base: number, level: number): [number, number] {
  return stat === "hp" ? [calcStat("hp", base, level, 0, 0), calcStat("hp", base, level, 31, 252)] : [calcStat(stat, base, level, 0, 0, 0.9), calcStat(stat, base, level, 31, 252, 1.1)];
}

export interface Spread {
  nature: string;
  evs: StatsTable;
  ivs: StatsTable;
}

/**
 * A spread that gives exactly `stats` (any it's given; HP too) at `level`:
 * a neutral nature first, the most IVs and fewest EVs per stat. Null if no
 * legal spread does (a transformed or form-changed Pokémon).
 */
export function solveSpread(base: StatsTable, level: number, stats: Partial<StatsTable>): Spread | null {
  for (const [nature, plus, minus] of NATURES) {
    const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
    let ok = true;
    for (const stat of STATS) {
      const want = stats[stat];
      if (want === undefined) continue;
      const mult = stat === plus ? 1.1 : stat === minus ? 0.9 : 1;
      let found = false;
      for (let iv = 31; iv >= 0 && !found; iv--) {
        for (let ev = 0; ev <= 252; ev += 4) {
          const got = calcStat(stat, base[stat], level, iv, ev, mult);
          if (got === want) {
            evs[stat] = ev;
            ivs[stat] = iv;
            found = true;
            break;
          }
          if (got > want) break;
        }
      }
      if (!found) {
        ok = false;
        break;
      }
    }
    if (ok) return { nature, evs, ivs };
  }
  return null;
}

/** What the battle screen knows of a Pokémon on the field. */
export interface FieldMon {
  species: string;
  level: number;
  /** Current HP as a percentage of max. */
  hpPercent: number;
  boosts: Record<string, number>;
  status: string;
  item?: string;
  ability?: string;
  teraType?: string;
  terastallized: boolean;
  /** Your own Pokémon: its exact stats (the request's, plus max HP). */
  stats?: Partial<StatsTable>;
}

/** A battle's field as the calculator reads it. */
export interface FieldState {
  doubles: boolean;
  weather: string;
  terrain: string;
  pseudo: string[];
  /** Side conditions (ids: reflect, lightscreen, auroraveil, spikes...) with their layers. */
  attacker: { id: string; level: number }[];
  defender: { id: string; level: number }[];
}

const BOOSTS: BoostKey[] = ["atk", "def", "spa", "spd", "spe"];
const STATUSES = new Set(["brn", "par", "psn", "tox", "slp", "frz"]);

/** A calculator side for a Pokémon on the field (see the spreads above). */
export function fieldSide(gen: Generation, mon: FieldMon, randomBattle: boolean): CalcSide {
  const side = emptySide(mon.species, mon.level);
  const species = gen.species.get(mon.species);
  const exact = species && mon.stats ? solveSpread(species.baseStats as StatsTable, mon.level, mon.stats) : null;
  if (exact) {
    side.nature = exact.nature;
    side.evs = exact.evs;
    side.ivs = exact.ivs;
  } else if (randomBattle) {
    side.evs = { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 };
  }
  side.ability = mon.ability ?? "";
  side.item = mon.item ?? "";
  side.status = (STATUSES.has(mon.status) ? mon.status : "") as StatusId;
  side.hpPercent = Math.max(1, Math.min(100, mon.hpPercent));
  side.teraType = mon.teraType ?? "";
  side.terastallized = mon.terastallized && !!mon.teraType;
  for (const b of BOOSTS) side.boosts[b] = Math.max(-6, Math.min(6, mon.boosts[b] ?? 0));
  return side;
}

/** The calculator's whole-field state: weather, terrain and rooms. */
export function fieldOf(state: FieldState): CalcField {
  return {
    gameType: state.doubles ? "Doubles" : "Singles",
    weather: state.weather,
    terrain: state.terrain,
    crit: false,
    flags: { isGravity: state.pseudo.includes("gravity"), isMagicRoom: state.pseudo.includes("magicroom"), isWonderRoom: state.pseudo.includes("wonderroom") },
  };
}

/** One side's screens and hazards as the calculator reads them. */
export function sideFlags(conds: { id: string; level: number }[]): CalcSide["flags"] {
  const has = (id: string) => conds.some((c) => c.id === id);
  return { isReflect: has("reflect"), isLightScreen: has("lightscreen"), isAuroraVeil: has("auroraveil"), isTailwind: has("tailwind"), isSR: has("stealthrock") };
}

/**
 * One move's damage from `attacker` to `defender` on the battle's field:
 * the calculator's range, percentages, KO chance and description.
 */
export function moveDamage(
  calc: { gen: Generation; lib: CalcModule },
  move: string,
  attacker: FieldMon,
  defender: FieldMon,
  state: FieldState,
  randomBattle: boolean
): CalcLine | null {
  const a = { ...fieldSide(calc.gen, attacker, randomBattle), moves: [move], flags: sideFlags(state.attacker) };
  const d = { ...fieldSide(calc.gen, defender, randomBattle), flags: sideFlags(state.defender), spikes: state.defender.find((c) => c.id === "spikes")?.level ?? 0 };
  return calcMoves(calc, a, d, fieldOf(state))[0] ?? null;
}
