import { expectedHits } from "./moves";
import type { ArmySpec, BattleSpec, EvPreset, GroupRule, ItemPolicy, MBMove, MBSpecies, Question, Roster, SetChoice, StatTable, UnitSet, UnitSpec } from "./types";

/**
 * Sets: what each species fights with. Pure and client-safe (the setup
 * panel uses the same rules as the battle).
 *
 * - Moves: the four chosen, or by default the random-battle set's attacking
 *   moves (the strongest first, then new types), or the attacking moves it
 *   knows by levelling up to its level.
 * - Ability: one of its own, its default first.
 * - Item: none unless chosen (or each set's random-battle item, with items
 *   on). Only items whose effect the battle models are offered.
 * - Nature: any of the 25. EVs and IVs: a preset.
 */

export const MAX_MOVES = 4;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 100;
export const clampLevel = (n: number) => Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(Number.isFinite(n) ? n : 100)));

type Stat = "atk" | "def" | "spa" | "spd" | "spe";

/** The 25 natures: the stat each raises and lowers (neutral natures raise and lower nothing). */
export const NATURES: Record<string, [Stat, Stat] | null> = {
  Hardy: null, Lonely: ["atk", "def"], Brave: ["atk", "spe"], Adamant: ["atk", "spa"], Naughty: ["atk", "spd"],
  Bold: ["def", "atk"], Docile: null, Relaxed: ["def", "spe"], Impish: ["def", "spa"], Lax: ["def", "spd"],
  Timid: ["spe", "atk"], Hasty: ["spe", "def"], Serious: null, Jolly: ["spe", "spa"], Naive: ["spe", "spd"],
  Modest: ["spa", "atk"], Mild: ["spa", "def"], Quiet: ["spa", "spe"], Bashful: null, Rash: ["spa", "spd"],
  Calm: ["spd", "atk"], Gentle: ["spd", "def"], Sassy: ["spd", "spe"], Careful: ["spd", "spa"], Quirky: null,
};
export const NATURE_NAMES = Object.keys(NATURES);
export const DEFAULT_NATURE = "Hardy";
export const natureName = (n: string | undefined) => NATURE_NAMES.find((k) => k.toLowerCase() === (n ?? "").toLowerCase()) ?? DEFAULT_NATURE;

const all = (v: number): StatTable => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v });

/** The EVs and IVs of a preset. Max offence puts 252 into the stat its moves attack with (Attack if most are physical). */
export function spreadOf(preset: EvPreset, moves: Pick<MBMove, "cat">[]): { evs: StatTable; ivs: StatTable } {
  if (preset === "offence") {
    const physical = moves.filter((m) => m.cat === "Physical").length;
    const special = moves.length - physical;
    const evs = { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 252 };
    if (physical >= special) evs.atk = 252;
    else evs.spa = 252;
    return { evs, ivs: all(31) };
  }
  if (preset === "bulk") return { evs: { hp: 252, atk: 0, def: 128, spa: 0, spd: 128, spe: 0 }, ivs: all(31) };
  return { evs: all(85), ivs: all(31) };
}

/** Held items whose effects the battle plays, by what they do (the damage calculator handles the damage ones). */
export const ITEM_GROUPS: { label: string; items: string[] }[] = [
  { label: "Damage", items: ["Life Orb", "Choice Band", "Choice Specs", "Expert Belt", "Muscle Band", "Wise Glasses", "Punching Glove", "Loaded Dice", "Light Ball", "Thick Club"] },
  { label: "Type boosts", items: ["Silk Scarf", "Charcoal", "Mystic Water", "Magnet", "Miracle Seed", "Never-Melt Ice", "Black Belt", "Poison Barb", "Soft Sand", "Sharp Beak", "Twisted Spoon", "Silver Powder", "Hard Stone", "Spell Tag", "Dragon Fang", "Black Glasses", "Metal Coat", "Fairy Feather"] },
  { label: "Defence", items: ["Assault Vest", "Eviolite", "Focus Sash", "Air Balloon", "Rocky Helmet", "Covert Cloak"] },
  { label: "Recovery", items: ["Leftovers", "Black Sludge", "Sitrus Berry", "Lum Berry", "Shell Bell"] },
  { label: "Speed and accuracy", items: ["Choice Scarf", "Quick Claw", "Scope Lens", "Razor Claw", "Wide Lens", "Zoom Lens", "Bright Powder", "King's Rock"] },
  { label: "Stat boosts", items: ["Weakness Policy"] },
];
export const MODELLED_ITEMS = new Set(ITEM_GROUPS.flatMap((g) => g.items));

/** A random-battle set's item the battle plays (the first it models), or "". */
export function pickItem(items: string[]): string {
  for (const it of items) if (MODELLED_ITEMS.has(it)) return it;
  return "";
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A rough strength for ranking (only for choosing the four moves; damage itself is the calculator's). */
export function moveScore(mv: MBMove, p: Pick<MBSpecies, "types" | "base">, level: number): number {
  const id = toId(mv.name);
  let power = mv.bp;
  if (!power) {
    if (id === "seismictoss" || id === "nightshade") power = Math.min(120, level);
    else if (id === "eruption" || id === "waterspout" || id === "dragonenergy") power = 150;
    else if (id === "crushgrip" || id === "wringout" || id === "hardpress") power = 100;
    else power = 60;
  }
  const stab = p.types.includes(mv.type.toLowerCase()) ? 1.5 : 1;
  const stat = mv.cat === "Physical" ? p.base.atk : p.base.spa;
  const acc = mv.acc ? mv.acc / 100 : 1;
  // A move that drops the user's own attacking stat (Draco Meteor, Overheat) is worth a little less over a long battle.
  const selfDrop = mv.fx?.some((f) => f.on === "self" && f.chance >= 100 && ((f.boosts?.atk ?? 0) < 0 || (f.boosts?.spa ?? 0) < 0)) ? 0.85 : 1;
  return power * expectedHits(mv.hits) * stab * stat * acc * (mv.crit >= 3 ? 1.5 : 1) * selfDrop;
}

/** Up to four moves: the strongest first, then the strongest of each new type, then the rest. */
export function pickFour(candidates: MBMove[], p: Pick<MBSpecies, "types" | "base">, level: number): MBMove[] {
  const pool = [...new Map(candidates.map((m) => [m.name, m])).values()];
  const out: MBMove[] = [];
  while (out.length < MAX_MOVES && pool.length) {
    let best = -1, bestScore = -Infinity;
    pool.forEach((m, i) => {
      const repeat = out.some((o) => o.type === m.type);
      const s = moveScore(m, p, level) * (repeat ? 0.4 : 1);
      // Ties go to the name, so the choice never depends on data order.
      if (s > bestScore || (s === bestScore && best >= 0 && m.name < pool[best].name)) { best = i; bestScore = s; }
    });
    out.push(pool.splice(best, 1)[0]);
  }
  return out;
}

/** The moves a species uses by default at a level. */
export function defaultMoves(s: MBSpecies, moves: MBMove[], level: number): MBMove[] {
  if (s.randbats) return pickFour(s.randbats.map((i) => moves[i]), s, 100);
  return pickFour(s.levelUp.filter(([, at]) => at <= level).map(([i]) => moves[i]), s, level);
}

/** A move list by name, keeping the roster's moves only (unknown names are dropped). */
export function movesByName(names: string[], byName: Map<string, MBMove>): MBMove[] {
  const out: MBMove[] = [];
  for (const n of names) {
    const m = byName.get(toId(n));
    if (m && !out.includes(m)) out.push(m);
    if (out.length >= MAX_MOVES) break;
  }
  return out;
}

export const moveIndex = (moves: MBMove[]) => new Map(moves.map((m) => [toId(m.name), m]));

/** A species' full set: its choices over its defaults. */
export function resolveSet(s: MBSpecies, roster: Pick<Roster, "moves">, choice: SetChoice | undefined, level: number, items: ItemPolicy, byName = moveIndex(roster.moves)): UnitSet {
  const lv = clampLevel(choice?.level ?? level);
  const chosen = choice?.moves?.length ? movesByName(choice.moves, byName) : null;
  const moves = chosen && chosen.length ? chosen : defaultMoves(s, roster.moves, lv);
  const ability = choice?.ability && s.abilities.some((a) => toId(a) === toId(choice.ability!)) ? s.abilities.find((a) => toId(a) === toId(choice.ability!))! : s.ability;
  const item = choice?.item !== undefined ? (MODELLED_ITEMS.has(choice.item) ? choice.item : "") : items === "sets" ? s.item : "";
  const evPreset = choice?.evs ?? "random";
  const { evs, ivs } = spreadOf(evPreset, moves);
  const tera = choice?.tera ? TYPE_BY_ID.get(toId(choice.tera)) ?? "" : "";
  return { level: lv, moves, ability, item, nature: natureName(choice?.nature), evs, ivs, evPreset, tera };
}

const TYPE_BY_ID = new Map(["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"].map((t) => [t.toLowerCase(), t]));

/** Two sets play the same (so their units can share a damage table row). */
export const setKey = (s: UnitSet) => [s.level, s.moves.map((m) => m.name).join("+"), s.ability, s.item, s.nature, s.evPreset, s.tera].join("|");

// ---------------------------------------------------------------------------
// Groups and armies
// ---------------------------------------------------------------------------

/** What a group filter reads about a species (from the roster, or the page's picker list). */
export interface GroupFacts {
  id: number;
  form: string;
  types: string[];
  gen: number;
  legendary: boolean;
  mythical: boolean;
  fullyEvolved: boolean;
  /** Has attacking moves by default. */
  attacks: boolean;
}

export const factsOf = (s: MBSpecies): GroupFacts => ({ id: s.id, form: s.form, types: s.types, gen: s.gen, legendary: s.legendary, mythical: s.mythical, fullyEvolved: s.fullyEvolved, attacks: !!s.randbats || s.levelUp.length > 0 });

/** Forms that belong in a group ("every Fire type"): default and regional forms, not battle-only Megas. */
const GROUP_FORMS = new Set(["", "alola", "galar", "hisui", "paldea"]);

export function matchesGroup(s: GroupFacts, g: GroupRule): boolean {
  if (!GROUP_FORMS.has(s.form) || !s.attacks) return false;
  if (g.types?.length && !g.types.every((t) => s.types.includes(t))) return false;
  if (g.gen && s.gen !== g.gen) return false;
  if (g.legendary === "no" && (s.legendary || s.mythical)) return false;
  if (g.legendary === true && g.mythical) {
    if (!s.legendary && !s.mythical) return false;
  } else {
    if (g.legendary === true && !s.legendary) return false;
    if (g.mythical && !s.mythical) return false;
  }
  if (g.fullyEvolved && !s.fullyEvolved) return false;
  return true;
}

export const groupMembers = <T extends GroupFacts>(species: T[], g: GroupRule) => species.filter((s) => matchesGroup(s, g));

/** A group's name: "Every fully evolved Fire type", "Every Gen 1 legendary". */
export function groupLabel(g: GroupRule): string {
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  const parts: string[] = [];
  if (g.fullyEvolved) parts.push("fully evolved");
  if (g.gen) parts.push(`Gen ${g.gen}`);
  const kind = g.legendary === true && g.mythical ? "legendary or mythical Pokémon" : g.legendary === true ? "legendary" : g.mythical ? "mythical" : "";
  const types = g.types?.length ? `${g.types.map(cap).join("/")} type` : "";
  const noun = kind && types ? `${types} ${kind}` : kind || (types ? types : "Pokémon");
  const not = g.legendary === "no" ? ", no legendaries" : "";
  return `Every ${[...parts, noun].join(" ")}${not}`;
}

/** An army's rows with every group spelled out as its species (the group's count and set for each). */
export function expandArmy(army: Pick<ArmySpec, "units">, species: GroupFacts[]): UnitSpec[] {
  const out: UnitSpec[] = [];
  for (const u of army.units) {
    if (u.group) {
      for (const s of groupMembers(species, u.group)) out.push({ id: s.id, count: u.count, ...(u.set ? { set: u.set } : {}) });
    } else out.push(u);
  }
  return out;
}

/** A battle with its groups spelled out (what the simulation is given; links keep the groups). */
export function expandSpec(spec: BattleSpec, species: GroupFacts[]): BattleSpec {
  if (!spec.sides.some((a) => a.units.some((u) => u.group))) return spec;
  return { ...spec, sides: [{ ...spec.sides[0], units: expandArmy(spec.sides[0], species) }, { ...spec.sides[1], units: expandArmy(spec.sides[1], species) }] };
}

/** A question with its groups spelled out: the army's size is then shared by every species of the group. */
export function expandQuestion(q: Question, species: GroupFacts[]): Question {
  if (!q.army.units.some((u) => u.group) && !q.boss.units.some((u) => u.group)) return q;
  return { ...q, army: { ...q.army, units: expandArmy(q.army, species).map((u) => ({ ...u, count: 1 })) }, boss: { ...q.boss, units: expandArmy(q.boss, species) } };
}
