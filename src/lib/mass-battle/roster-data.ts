import { Dex } from "@pkmn/dex";
import { calculate, Field, Generations, Move, Pokemon as CalcMon } from "@smogon/calc";
import detailsData from "@/data/pokedex-details.json";
import movesData from "@/data/moves.json";
import artData from "@/data/sizes-art.json";
import { knownSet } from "@/lib/battle/cpu-policy";
import { POKEDEX, type Pokemon } from "@/lib/pokemon/pokedex";
import { expectedHits } from "./moves";
import { EV, IV, NATURE } from "./stats";
import type { BattleLevel, MBMove, MBSpecies, Roster } from "./types";

/**
 * The Mass Battle roster, built on the server (at build time: the route that
 * serves it is static) from the repo's own data, with nothing made up:
 *
 * - Species, base stats, types, height, weight: src/data/pokedex.json.
 * - Sets: Showdown's Gen 9 random-battle data (src/data/battle/randsets.json,
 *   read with knownSet). Its ability, the item that changes damage if it
 *   lists one, and up to four of its attacking moves.
 * - Pokémon without a random-battle set (Magikarp, Rattata…): their real
 *   level-up learnset (src/data/pokedex-details.json, the latest game that
 *   has them) up to the battle's level, with move data from
 *   src/data/moves.json; their first regular ability; no item.
 * - Move rules (targets, contact, multi-hit, critical-hit ratio, recoil,
 *   drain, priority): Showdown's own move data, @pkmn/dex.
 *
 * Moves the simulation can't play fairly yet are left out: status moves,
 * moves that charge or recharge, that faint the user, one-hit KO moves, and
 * moves that only work in a situation it doesn't track (Fake Out, Focus
 * Punch, Dream Eater…), plus anything the damage calculator gives no damage
 * for (Super Fang, Endeavor, Counter…).
 */

interface RawMove {
  name: string;
  type: string;
  cls: string;
  power: number | null;
  accuracy: number | null;
  priority: number;
}
interface RawDetails {
  abilities: { name: string; hidden: boolean }[];
  learnset: { game: string; moves: [number, string, number, string?][] } | null;
}

const MOVES = movesData as unknown as Record<string, RawMove>;
const DETAILS = detailsData as unknown as Record<string, RawDetails>;
const ART = artData as unknown as Record<string, [number, number, number, number, number]>;

export const ROSTER_VERSION = 1;
export const RANDSETS_FORMAT = "gen9randombattle";

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Moves left out of v1, by Showdown id (beyond the rules in `playable`). */
export const EXCLUDED_MOVES = new Set([
  "fakeout", "firstimpression", "focuspunch", "belch", "lastresort", "dreameater", "steelroller", "poltergeist",
  "synchronoise", "burnup", "doubleshock", "snore", "spitup", "counter", "mirrorcoat", "metalburst", "comeuppance",
  "bide", "superfang", "naturesmadness", "ruination", "endeavor", "finalgambit", "present", "magnitude",
  "naturalgift", "fling", "futuresight", "doomdesire", "beatup", "shelltrap", "struggle", "hiddenpower", "trumpcard",
  "mindblown", "steelbeam", "chloroblast", "upperhand", "skydrop", "naturepower", "sleeptalk", "spectralthief",
  "aurawheel", "ivycudgel", "ragingbull",
]);

/** Why a move can't be used here, or null when it can. */
export function unplayable(id: string): string | null {
  const m = Dex.moves.get(id);
  if (!m.exists) return "unknown";
  if (m.category === "Status") return "status";
  if (m.flags.charge) return "charges";
  if (m.flags.recharge) return "recharges";
  if (m.selfdestruct) return "faints the user";
  if (m.ohko) return "one-hit KO";
  if (m.isZ || m.isMax) return "Z or Max";
  if (EXCLUDED_MOVES.has(m.id)) return "situational";
  return null;
}

const SPREAD_TARGETS = new Set(["allAdjacent", "allAdjacentFoes"]);

/** A move's rules from Showdown's data. */
export function moveInfo(name: string): MBMove {
  const m = Dex.moves.get(name);
  const mh = m.multihit;
  return {
    name: m.name,
    type: m.type,
    cat: m.category === "Special" ? "Special" : "Physical",
    bp: m.basePower,
    acc: m.accuracy === true ? 0 : m.accuracy,
    pri: m.priority,
    contact: !!m.flags.contact,
    spread: SPREAD_TARGETS.has(m.target),
    hits: mh === undefined ? null : Array.isArray(mh) ? [mh[0], mh[1]] : [mh, mh],
    multiAcc: !!m.multiaccuracy,
    crit: m.willCrit ? 3 : Math.max(0, (m.critRatio ?? 1) - 1),
    recoil: m.recoil ? [m.recoil[0], m.recoil[1]] : null,
    drain: m.drain ? [m.drain[0], m.drain[1]] : null,
  };
}

// ---------------------------------------------------------------------------
// The damage calculator's view (to check it can work a move out at all)
// ---------------------------------------------------------------------------

const CALC_GEN = Generations.get(9);
const EVS = { hp: EV, atk: EV, def: EV, spa: EV, spd: EV, spe: EV };
const IVS = { hp: IV, atk: IV, def: IV, spa: IV, spd: IV, spe: IV };

/** The calculator's name for a Pokédex species: the same name, or the forme with the same base stats ("Minior-Meteor", "Aegislash-Shield"). */
export function calcName(p: Pick<Pokemon, "name" | "slug" | "stats">): string | null {
  const same = (s: { baseStats: Record<string, number> }) => (["hp", "atk", "def", "spa", "spd", "spe"] as const).every((k) => s.baseStats[k] === p.stats[k]);
  for (const key of [p.name, p.slug]) {
    const s = CALC_GEN.species.get(toId(key) as never);
    if (s && same(s)) return s.name;
  }
  for (const s of CALC_GEN.species) if ((s.name === p.name || s.name.startsWith(`${p.name}-`)) && same(s)) return s.name;
  return null;
}

let probeTarget: CalcMon | null = null;
const workable = new Map<string, boolean>();
/** Whether the calculator gives the move any damage (against Mew, which no type is immune to… except the ones Psychic is immune to: none). */
function calcWorks(move: string, attacker: string): boolean {
  const key = `${attacker}|${move}`;
  const known = workable.get(key);
  if (known !== undefined) return known;
  probeTarget ??= new CalcMon(CALC_GEN, "Mew", { level: 100, nature: NATURE, evs: EVS, ivs: IVS });
  let ok = false;
  try {
    const a = new CalcMon(CALC_GEN, attacker, { level: 100, nature: NATURE, evs: EVS, ivs: IVS });
    const r = calculate(CALC_GEN, a, probeTarget, new Move(CALC_GEN, move), new Field({ gameType: "Singles" }));
    ok = r.range()[1] > 0;
  } catch {
    ok = false;
  }
  workable.set(key, ok);
  return ok;
}

// ---------------------------------------------------------------------------
// Choosing four attacking moves
// ---------------------------------------------------------------------------


/** A rough strength for ranking (only for choosing the four moves; damage itself is the calculator's). */
function moveScore(mv: MBMove, p: Pick<MBSpecies, "types" | "base">, level: number): number {
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
  return power * expectedHits(mv.hits) * stab * stat * acc * (mv.crit >= 3 ? 1.5 : 1);
}

/** Up to four moves: the strongest first, then the strongest of each new type, then the rest. */
export function pickFour(candidates: MBMove[], p: Pick<MBSpecies, "types" | "base">, level: number): MBMove[] {
  const pool = [...new Map(candidates.map((m) => [m.name, m])).values()];
  const out: MBMove[] = [];
  while (out.length < 4 && pool.length) {
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

/** Items whose effect is on damage, best first (the only item effects the battle has). */
const DAMAGE_ITEMS = [
  "Life Orb", "Light Ball", "Thick Club", "Choice Band", "Choice Specs", "Expert Belt", "Loaded Dice",
  "Charcoal", "Mystic Water", "Miracle Seed", "Magnet", "Never-Melt Ice", "Black Belt", "Poison Barb", "Soft Sand",
  "Sharp Beak", "Twisted Spoon", "Silver Powder", "Hard Stone", "Spell Tag", "Dragon Fang", "Black Glasses",
  "Metal Coat", "Fairy Feather", "Silk Scarf", "Muscle Band", "Wise Glasses", "Punching Glove",
  "Eviolite", "Assault Vest",
];

export function pickItem(items: string[]): string {
  for (const it of DAMAGE_ITEMS) if (items.includes(it)) return it;
  return "";
}

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

const abilityName = (slug: string) => {
  const a = Dex.abilities.get(slug);
  return a.exists ? a.name : slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
};

/** Level-up moves known by `level` that the battle can play, from the species' latest learnset. */
export function levelUpMoves(id: number, level: number): string[] {
  const ls = DETAILS[String(id)]?.learnset;
  if (!ls) return [];
  const names: string[] = [];
  for (const [moveId, method, at] of ls.moves) {
    if (method !== "L" || at > level) continue;
    const raw = MOVES[String(moveId)];
    if (!raw || raw.cls === "status") continue;
    names.push(raw.name);
  }
  return names;
}

export interface BuiltSpecies {
  species: MBSpecies;
  moves: Record<BattleLevel, MBMove[]>;
}

export function buildSpecies(p: Pokemon): BuiltSpecies | null {
  const calc = calcName(p);
  const box = ART[String(p.id)];
  if (!calc || !box) return null;
  const set = knownSet(RANDSETS_FORMAT, p.name) ?? knownSet(RANDSETS_FORMAT, p.slug);
  const base = { ...p.stats };
  const who = { types: p.types as string[], base };
  const usable = (names: string[]) =>
    names
      .filter((n) => !unplayable(toId(n)))
      .map((n) => moveInfo(n))
      .filter((m) => calcWorks(m.name, calc));
  let moves: Record<BattleLevel, MBMove[]>;
  let ability: string;
  let item = "";
  if (set) {
    const four = pickFour(usable(set.moves), who, 100);
    moves = { 50: four, 100: four };
    ability = set.abilities[0] ?? abilityName(p.abilities.find((a) => !a.hidden)?.name ?? p.abilities[0]?.name ?? "");
    item = pickItem(set.items);
  } else {
    moves = { 50: pickFour(usable(levelUpMoves(p.id, 50)), who, 50), 100: pickFour(usable(levelUpMoves(p.id, 100)), who, 100) };
    ability = abilityName(p.abilities.find((a) => !a.hidden)?.name ?? p.abilities[0]?.name ?? "");
  }
  return {
    species: {
      id: p.id,
      slug: p.slug,
      name: p.name,
      calc,
      types: [...p.types],
      base,
      m: p.height / 10,
      kg: p.weight / 10,
      shape: p.shape,
      gen: p.gen,
      legendary: p.legendary,
      mythical: p.mythical,
      fullyEvolved: p.fullyEvolved,
      ability,
      item,
      moves: { 50: [], 100: [] },
      source: set ? "randbats" : "learnset",
      box: [...box] as MBSpecies["box"],
    },
    moves,
  };
}

let cached: Roster | null = null;

/** Every Pokémon the battle can field, with its set. */
export function buildRoster(): Roster {
  if (cached) return cached;
  const moves: MBMove[] = [];
  const index = new Map<string, number>();
  const ref = (m: MBMove) => {
    let i = index.get(m.name);
    if (i === undefined) {
      i = moves.length;
      moves.push(m);
      index.set(m.name, i);
    }
    return i;
  };
  const species: MBSpecies[] = [];
  for (const p of POKEDEX) {
    const built = buildSpecies(p);
    if (!built) continue;
    built.species.moves = { 50: built.moves[50].map(ref), 100: built.moves[100].map(ref) };
    species.push(built.species);
  }
  cached = { version: ROSTER_VERSION, moves, species };
  return cached;
}

/** The roster as served: the same data, keyed for lookups. */
export const rosterById = () => new Map(buildRoster().species.map((s) => [s.id, s]));
