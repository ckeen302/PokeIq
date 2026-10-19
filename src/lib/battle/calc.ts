import type { Generation } from "@pkmn/data";
import type * as CalcLib from "@smogon/calc/dist/adaptable";
import type { StatKey } from "@/lib/pokemon/constants";
import type { StatsTable, TeamSet } from "./sets";

/**
 * Damage calculator state and the glue to @smogon/calc (its "adaptable"
 * build, run on the same @pkmn/data the team builder uses). The calc library
 * is passed in rather than imported, so the page can load it on demand.
 */

export type CalcModule = typeof CalcLib;
export type BoostKey = Exclude<StatKey, "hp">;
export type StatusId = "" | "brn" | "par" | "psn" | "tox" | "slp" | "frz";

export const WEATHERS = ["Sun", "Rain", "Sand", "Snow", "Hail", "Harsh Sunshine", "Heavy Rain", "Strong Winds"] as const;
export const TERRAINS = ["Electric", "Grassy", "Psychic", "Misty"] as const;
export const STATUSES: { id: StatusId; label: string }[] = [
  { id: "", label: "Healthy" },
  { id: "brn", label: "Burned" },
  { id: "par", label: "Paralyzed" },
  { id: "psn", label: "Poisoned" },
  { id: "tox", label: "Badly poisoned" },
  { id: "slp", label: "Asleep" },
  { id: "frz", label: "Frozen" },
];

/** Screens, support and hazards on one side of the field. */
export const SIDE_FLAGS = [
  ["isReflect", "Reflect"],
  ["isLightScreen", "Light Screen"],
  ["isAuroraVeil", "Aurora Veil"],
  ["isHelpingHand", "Helping Hand"],
  ["isFriendGuard", "Friend Guard"],
  ["isBattery", "Battery"],
  ["isPowerSpot", "Power Spot"],
  ["isSteelySpirit", "Steely Spirit"],
  ["isFlowerGift", "Flower Gift"],
  ["isTailwind", "Tailwind"],
  ["isProtected", "Protect"],
  ["isSR", "Stealth Rock"],
  ["isSeeded", "Leech Seed"],
  ["isSaltCured", "Salt Cure"],
] as const;
export type SideFlag = (typeof SIDE_FLAGS)[number][0];

/** Whole-field effects. */
export const FIELD_FLAGS = [
  ["isGravity", "Gravity"],
  ["isMagicRoom", "Magic Room"],
  ["isWonderRoom", "Wonder Room"],
  ["isBeadsOfRuin", "Beads of Ruin"],
  ["isSwordOfRuin", "Sword of Ruin"],
  ["isTabletsOfRuin", "Tablets of Ruin"],
  ["isVesselOfRuin", "Vessel of Ruin"],
  ["isFairyAura", "Fairy Aura"],
  ["isDarkAura", "Dark Aura"],
  ["isAuraBreak", "Aura Break"],
] as const;
export type FieldFlag = (typeof FIELD_FLAGS)[number][0];

export interface CalcSide {
  species: string;
  level: number;
  ability: string;
  /** For abilities with an "active" state (Flash Fire, Slow Start…). */
  abilityOn: boolean;
  item: string;
  nature: string;
  evs: StatsTable;
  ivs: StatsTable;
  boosts: Record<BoostKey, number>;
  status: StatusId;
  teraType: string;
  terastallized: boolean;
  /** Current HP as a percentage of max. */
  hpPercent: number;
  moves: string[];
  flags: Partial<Record<SideFlag, boolean>>;
  spikes: number;
}

export interface CalcField {
  gameType: "Singles" | "Doubles";
  weather: string;
  terrain: string;
  crit: boolean;
  flags: Partial<Record<FieldFlag, boolean>>;
}

export interface CalcLine {
  move: string;
  type: string;
  category: string;
  /** Damage in HP, and as a percentage of the target's max HP. */
  damage: [number, number];
  percent: [number, number];
  /** "guaranteed 2HKO", "37.5% chance to OHKO"… empty when there's no damage. */
  ko: string;
  /** Showdown's full description line. */
  desc: string;
  /** Every damage roll, when the move hits once. */
  rolls: number[];
}

const zeros = (): StatsTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
const perfect = (): StatsTable => ({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });

export function emptySide(species: string, level = 100): CalcSide {
  return {
    species,
    level,
    ability: "",
    abilityOn: false,
    item: "",
    nature: "Hardy",
    evs: zeros(),
    ivs: perfect(),
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: "",
    teraType: "",
    terastallized: false,
    hpPercent: 100,
    moves: [],
    flags: {},
    spikes: 0,
  };
}

/** A calc side from a saved team member (its field conditions start clear). */
export function sideFromSet(set: TeamSet): CalcSide {
  return {
    ...emptySide(set.species, set.level || 100),
    ability: set.ability,
    item: set.item,
    nature: set.nature || "Hardy",
    evs: { ...zeros(), ...set.evs },
    ivs: { ...perfect(), ...set.ivs },
    teraType: set.teraType ?? "",
    moves: set.moves.slice(0, 4),
  };
}

export const emptyField = (): CalcField => ({ gameType: "Singles", weather: "", terrain: "", crit: false, flags: {} });

type Calc = { gen: Generation; lib: CalcModule };
type CalcGen = Parameters<CalcModule["calculate"]>[0];
// @pkmn/data's Generation is the calc's data interface in all but a few type names.
const asCalcGen = (gen: Generation) => gen as unknown as CalcGen;

export function makePokemon({ gen, lib }: Calc, side: CalcSide): CalcLib.Pokemon {
  const pokemon = new lib.Pokemon(asCalcGen(gen), side.species, {
    level: side.level,
    ability: side.ability || undefined,
    abilityOn: side.abilityOn,
    item: side.item || undefined,
    nature: side.nature || undefined,
    evs: side.evs,
    ivs: side.ivs,
    boosts: side.boosts,
    status: side.status,
    teraType: side.terastallized && side.teraType ? side.teraType : undefined,
    moves: side.moves.filter(Boolean),
  } as ConstructorParameters<CalcModule["Pokemon"]>[2]);
  const max = pokemon.maxHP();
  pokemon.originalCurHP = Math.max(1, Math.min(max, Math.round((max * side.hpPercent) / 100)));
  return pokemon;
}

function makeField({ lib }: Calc, field: CalcField, attacker: CalcSide, defender: CalcSide): CalcLib.Field {
  const side = (s: CalcSide) => ({ ...s.flags, spikes: s.spikes });
  return new lib.Field({
    gameType: field.gameType,
    weather: (field.weather || undefined) as CalcLib.Field["weather"],
    terrain: (field.terrain || undefined) as CalcLib.Field["terrain"],
    ...field.flags,
    attackerSide: side(attacker),
    defenderSide: side(defender),
  });
}

/** Every move of `attacker` against `defender`. */
export function calcMoves(calc: Calc, attacker: CalcSide, defender: CalcSide, field: CalcField): CalcLine[] {
  const { gen, lib } = calc;
  const atk = makePokemon(calc, attacker);
  const def = makePokemon(calc, defender);
  const fieldState = makeField(calc, field, attacker, defender);
  const lines: CalcLine[] = [];
  for (const name of attacker.moves) {
    const data = name ? gen.moves.get(name) : undefined;
    // Typeless moves (Struggle) aren't in @pkmn/data's type chart.
    if (!data || !gen.types.get(data.type)) continue;
    const base: CalcLine = { move: data.name, type: data.type, category: data.category, damage: [0, 0], percent: [0, 0], ko: "", desc: "", rolls: [] };
    try {
      const move = new lib.Move(asCalcGen(gen), name, { isCrit: field.crit });
      const result = lib.calculate(asCalcGen(gen), atk.clone(), def.clone(), move, fieldState.clone());
      const [min, max] = result.range();
      const hp = result.defender.maxHP();
      // The calc's own text for a hit that does nothing logs a warning; say it here instead.
      const hits = max > 0 || move.category === "Status";
      lines.push({
        ...base,
        damage: [min, max],
        // Showdown's calculator floors to a tenth of a percent (20.93% is 20.9%).
        percent: [Math.floor((min * 1000) / hp) / 10, Math.floor((max * 1000) / hp) / 10],
        ko: max > 0 ? result.kochance(false).text : "",
        desc: hits ? result.fullDesc("%", false) : `${result.attacker.name} ${move.name} vs. ${result.defender.name}: 0-0 (0 - 0%)`,
        rolls: Array.isArray(result.damage) && typeof result.damage[0] === "number" ? (result.damage as number[]) : [],
      });
    } catch {
      lines.push({ ...base, desc: "The calculator can't work this move out yet." });
    }
  }
  return lines;
}
