import { Dex } from "@pkmn/dex";
import { Dex as SimDex } from "@pkmn/sim";
import { calculate, Field, Generations, Move, Pokemon as CalcMon } from "@smogon/calc";
import detailsData from "@/data/pokedex-details.json";
import movesData from "@/data/moves.json";
import artData from "@/data/sizes-art.json";
import formsData from "@/data/sizes-forms.json";
import { knownSet } from "@/lib/battle/cpu-policy";
import { POKEDEX, type Pokemon } from "@/lib/pokemon/pokedex";
import { pickItem } from "./sets";
import type { Boosts, MBMove, MBSpecies, MoveEffect, MoveRule, Roster, StatusId } from "./types";

/**
 * The Mass Battle roster, built on the server (at build time: the route that
 * serves it is static) from the repo's own data, with nothing made up:
 *
 * - Species, base stats, types, height, weight: src/data/pokedex.json; the
 *   battle forms (Megas, Alolan, Galarian, Hisuian and Paldean forms) that
 *   have a HOME render and relief map on the site: src/data/sizes-forms.json
 *   for their size, Showdown's data for their stats, types and abilities.
 * - Default sets: Showdown's Gen 9 random-battle data (src/data/battle/
 *   randsets.json, read with knownSet): its ability, the item it holds if
 *   the battle models it (held only with items on), its Tera types and its
 *   attacking moves. A Mega uses its species' set with its own ability.
 * - Pokémon without a random-battle set (Magikarp, Rattata…): the attacking
 *   moves they learn by levelling up (src/data/pokedex-details.json, the
 *   latest game that has them; Showdown's learnsets for forms), their first
 *   regular ability and no item.
 * - Every move a species can legally learn (for choosing its moves): its
 *   Showdown learnset in the latest generation it appears in, its
 *   pre-evolutions' included (buildLearnsets).
 * - Move rules (targets, contact, multi-hit, critical-hit ratio, recoil,
 *   drain, priority, side effects): Showdown's own move data, @pkmn/dex.
 *
 * Status moves the battle plays (boosts, healing, status, Protect, Leech
 * Seed, screens: see MoveRule in types.ts) are kept with the rest; moves
 * that need what a battle without switching doesn't have (hazards, Taunt,
 * Encore, Sleep Talk, Future Sight…) are left out, as is anything else the
 * damage calculator gives no damage for.
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
interface FormRow {
  id: number;
  species: number;
  slug: string;
  name: string;
  kind: string;
  height: number;
  weight: number;
  types: string[];
}

const MOVES = movesData as unknown as Record<string, RawMove>;
const DETAILS = detailsData as unknown as Record<string, RawDetails>;
const ART = artData as unknown as Record<string, [number, number, number, number, number]>;
const FORMS = (formsData as unknown as { forms: FormRow[] }).forms;

/** Bumped when the roster's shape or its sets change. */
export const ROSTER_VERSION = 4;
export const RANDSETS_FORMAT = "gen9randombattle";
/** Forms the battle fields (Gigantamax and Eternamax forms only exist in Dynamax battles). */
export const BATTLE_FORMS = new Set(["mega", "regional"]);
const REGIONS = ["alola", "galar", "hisui", "paldea"] as const;
/** "mega", or the region of a regional form ("alola"…). */
const formKind = (f: Pick<FormRow, "kind" | "slug">) => (f.kind === "mega" ? "mega" : REGIONS.find((r) => f.slug.includes(`-${r}`)) ?? "regional");
const FORM_GEN: Record<string, number> = { alola: 7, galar: 8, hisui: 8, paldea: 9 };

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Moves left out, by Showdown id (beyond the rules in `unplayable`): their damage or their point depends on something
 * the battle doesn't track (switching, items being used, the move another Pokémon picked), so it can't play them fairly.
 */
export const EXCLUDED_MOVES = new Set([
  "belch", "lastresort", "steelroller", "poltergeist",
  "synchronoise", "burnup", "doubleshock", "snore", "spitup",
  "bide", "present", "magnitude",
  "naturalgift", "fling", "futuresight", "doomdesire", "beatup", "shelltrap", "struggle", "hiddenpower", "trumpcard",
  "mindblown", "steelbeam", "chloroblast", "upperhand", "skydrop", "naturepower", "sleeptalk", "spectralthief",
  "aurawheel", "ivycudgel", "ragingbull", "storedpower", "powertrip", "punishment", "geomancy", "freezeshock", "iceburn",
]);

/** Status moves the battle plays, by what they do (everything else that is Status is left out: hazards need switching, Taunt and Encore a memory of moves…). */
const BOOST_SPECIAL = new Set(["growth", "curse", "takeheart", "bellydrum", "filletaway", "clangoroussoul"]);
const HEALS: Record<string, MoveRule> = {
  recover: { kind: "heal", share: 1 / 2 }, roost: { kind: "heal", share: 1 / 2 }, slackoff: { kind: "heal", share: 1 / 2 },
  softboiled: { kind: "heal", share: 1 / 2 }, milkdrink: { kind: "heal", share: 1 / 2 }, healorder: { kind: "heal", share: 1 / 2 },
  synthesis: { kind: "heal", share: 1 / 2, weather: "sun" }, morningsun: { kind: "heal", share: 1 / 2, weather: "sun" },
  moonlight: { kind: "heal", share: 1 / 2, weather: "sun" }, shoreup: { kind: "heal", share: 1 / 2, weather: "sand" },
  rest: { kind: "rest" },
};
const INFLICT = new Set(["willowisp", "thunderwave", "toxic", "spore", "sleeppowder", "hypnosis", "sing", "lovelykiss", "grasswhistle", "darkvoid", "glare", "stunspore", "poisonpowder", "poisongas", "confuseray", "supersonic", "sweetkiss"]);
const SCREENS: Record<string, "reflect" | "lightscreen" | "auroraveil"> = { reflect: "reflect", lightscreen: "lightscreen", auroraveil: "auroraveil" };
const HIDES: Record<string, "air" | "under" | "water" | "gone"> = { fly: "air", bounce: "air", dig: "under", dive: "water", phantomforce: "gone", shadowforce: "gone" };
const CHARGE_BOOSTS: Record<string, Boosts> = { skullbash: { def: 1 }, meteorbeam: { spa: 1 }, electroshot: { spa: 1 } };
const FIXED: Record<string, "half" | "level" | "endeavor" | "gambit" | number> = {
  superfang: "half", ruination: "half", naturesmadness: "half", seismictoss: "level", nightshade: "level",
  dragonrage: 40, sonicboom: 20, endeavor: "endeavor", finalgambit: "gambit",
};
const COUNTERS: Record<string, { counters: "Physical" | "Special" | "any"; mul: number }> = {
  counter: { counters: "Physical", mul: 2 }, mirrorcoat: { counters: "Special", mul: 2 }, metalburst: { counters: "any", mul: 1.5 }, comeuppance: { counters: "any", mul: 1.5 },
};

/** The rule a move plays by, when it's a status move or an attacking move with a special one (undefined: an ordinary attack; null: a status move the battle doesn't play). */
export function moveRule(id: string): MoveRule | null | undefined {
  const m = Dex.moves.get(id);
  const raw = m as unknown as { boosts?: Boosts; heal?: number[]; status?: string; volatileStatus?: string; sideCondition?: string; selfdestruct?: string; ohko?: boolean | string; damage?: number | string };
  if (m.category === "Status") {
    if (m.id === "memento") return { kind: "selfdestruct", drops: { atk: -2, spa: -2 } };
    if (HEALS[m.id]) return HEALS[m.id];
    if (m.id === "protect" || m.id === "detect") return { kind: "protect" };
    if (m.id === "leechseed") return { kind: "leechseed" };
    if (SCREENS[m.id]) return { kind: "screen", screen: SCREENS[m.id] };
    if (INFLICT.has(m.id)) return raw.volatileStatus === "confusion" ? { kind: "inflict", confuse: true } : { kind: "inflict", status: raw.status as StatusId };
    if (m.target === "self" && BOOST_SPECIAL.has(m.id)) {
      if (m.id === "growth") return { kind: "boost", boosts: { atk: 1, spa: 1 } };
      if (m.id === "curse") return { kind: "boost", boosts: { atk: 1, def: 1, spe: -1 } };
      if (m.id === "takeheart") return { kind: "boost", boosts: { spa: 1, spd: 1 } };
      return null;
    }
    if (m.id === "curse") return { kind: "boost", boosts: { atk: 1, def: 1, spe: -1 } };
    if (m.target === "self" && raw.boosts && !raw.heal && !raw.volatileStatus) return { kind: "boost", boosts: { ...raw.boosts } };
    return null;
  }
  if (m.flags.charge) return { kind: "charge", sunSkips: m.id === "solarbeam" || m.id === "solarblade", rainSkips: m.id === "electroshot", boosts: CHARGE_BOOSTS[m.id], hide: HIDES[m.id] };
  if (m.flags.recharge) return { kind: "recharge" };
  if (raw.selfdestruct === "always") return { kind: "selfdestruct" };
  if (FIXED[m.id] !== undefined) return { kind: "fixed", fixed: FIXED[m.id] };
  if (raw.ohko) return { kind: "ohko" };
  if (m.id === "fakeout" || m.id === "firstimpression") return { kind: "fakeout" };
  if (COUNTERS[m.id]) return { kind: "counter", ...COUNTERS[m.id] };
  if (m.id === "focuspunch") return { kind: "focuspunch" };
  if (m.id === "dreameater") return { kind: "dreameater" };
  return undefined;
}

/** Why a move can't be used here, or null when it can. */
export function unplayable(id: string): string | null {
  const m = Dex.moves.get(id);
  if (!m.exists) return "unknown";
  if (m.isZ || m.isMax) return "Z or Max";
  if (EXCLUDED_MOVES.has(m.id)) return "situational";
  const rule = moveRule(m.id);
  if (rule === null) return "status";
  if (m.id === "curse") return null;
  return null;
}

/** Moves whose damage isn't the calculator's (fixed damage, one-hit KOs, Counter), or that do none (status moves). */
export const noCalc = (rule: MoveRule | null | undefined) => !!rule && (rule.kind === "fixed" || rule.kind === "ohko" || rule.kind === "counter" || (rule.kind === "selfdestruct" && !!rule.drops) || ["boost", "heal", "rest", "inflict", "protect", "leechseed", "screen"].includes(rule.kind));

const SPREAD_TARGETS = new Set(["allAdjacent", "allAdjacentFoes"]);
const BEST_STAT = new Set(["photongeyser", "shellsidearm", "terablast", "lightthatburnsthesky", "terastarstorm"]);

type Secondary = { chance?: number; status?: string; volatileStatus?: string; boosts?: Record<string, number>; self?: { boosts?: Record<string, number> } };

/** A move's side effects, as Showdown lists them: chance effects on the target or the user, and the user's own after-effects. */
export function moveFx(id: string): MoveEffect[] {
  const m = Dex.moves.get(id);
  const fx: MoveEffect[] = [];
  const secs = (m.secondaries ?? (m.secondary ? [m.secondary] : [])) as Secondary[];
  for (const s of secs) {
    const chance = s.chance ?? 100;
    if (s.status) fx.push({ chance, on: "target", status: s.status as StatusId });
    if (s.volatileStatus === "flinch") fx.push({ chance, on: "target", flinch: true });
    if (s.volatileStatus === "confusion") fx.push({ chance, on: "target", confuse: true });
    if (s.boosts) fx.push({ chance, on: "target", boosts: { ...s.boosts } });
    if (s.self?.boosts) fx.push({ chance, on: "self", boosts: { ...s.self.boosts } });
  }
  // Tri Attack: a 20% chance of one of burn, paralysis or freezing.
  if (m.id === "triattack") for (const status of ["brn", "par", "frz"] as const) fx.push({ chance: 20 / 3, on: "target", status });
  // The user's own after-effect (Close Combat's drops): not a side effect, so Sheer Force and Shield Dust don't touch it.
  const self = (m as { self?: { boosts?: Record<string, number> } }).self;
  if (self?.boosts) fx.push({ chance: 100, on: "self", boosts: { ...self.boosts }, always: true });
  return fx;
}

/** A move's rules from Showdown's data. */
export function moveInfo(name: string): MBMove {
  const m = Dex.moves.get(name);
  const mh = m.multihit;
  const raw = m as unknown as { overrideOffensiveStat?: string; overrideOffensivePokemon?: string; overrideDefensiveStat?: string; thawsTarget?: boolean };
  const fx = moveFx(m.id);
  const out: MBMove = {
    name: m.name,
    type: m.type,
    cat: m.category === "Status" ? "Status" : m.category === "Special" ? "Special" : "Physical",
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
  if (fx.length) out.fx = fx;
  if (raw.overrideOffensiveStat === "def") out.atkStat = "def";
  else if (raw.overrideOffensivePokemon === "target") out.atkStat = "target-atk";
  else if (BEST_STAT.has(m.id)) out.atkStat = "best";
  if (raw.overrideDefensiveStat === "def" && out.cat === "Special") out.hitsDef = true;
  if (m.flags.sound) out.sound = true;
  if (m.flags.punch) out.punch = true;
  if (m.flags.defrost) out.thaws = true;
  if ((m as { self?: { volatileStatus?: string } }).self?.volatileStatus === "lockedmove") out.rampage = true;
  if ((m as { hasCrashDamage?: boolean }).hasCrashDamage) out.crash = true;
  out.pp = (m as { noPPBoosts?: boolean }).noPPBoosts ? m.pp : Math.floor((m.pp * 8) / 5);
  if (m.target === "allAdjacent") out.allies = true;
  if (m.flags.protect) out.protectable = true;
  if (m.flags.reflectable) out.reflectable = true;
  if (m.flags.powder) out.powder = true;
  if ((m as { volatileStatus?: string }).volatileStatus === "partiallytrapped") out.binds = true;
  const rule = moveRule(m.id);
  if (rule) out.effect = rule;
  return out;
}

// ---------------------------------------------------------------------------
// The damage calculator's view (to check it can work a move out at all)
// ---------------------------------------------------------------------------

const CALC_GEN = Generations.get(9);
const EVS = { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 };
const IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

/** The calculator's name for a species: the same name, or the forme with the same base stats ("Minior-Meteor", "Aegislash-Shield"). */
export function calcName(p: Pick<Pokemon, "name" | "slug" | "stats">): string | null {
  const same = (s: { baseStats: Record<string, number> }) => (["hp", "atk", "def", "spa", "spd", "spe"] as const).every((k) => s.baseStats[k] === p.stats[k]);
  for (const key of [p.name, p.slug]) {
    const s = CALC_GEN.species.get(toId(key) as never);
    if (s && same(s)) return s.name;
  }
  for (const s of CALC_GEN.species) if ((s.name === p.name || s.name.startsWith(`${p.name}-`)) && same(s)) return s.name;
  return null;
}

/** The calculator's (and Showdown's) name for a form on the site ("raichu-alola" → "Raichu-Alola", "tauros-paldea-blaze-breed" → "Tauros-Paldea-Blaze"). */
export function formCalcName(slug: string): string | null {
  const tries = [slug, slug.replace(/-breed$/, ""), slug.replace(/-standard$/, "")];
  for (const t of tries) {
    const s = CALC_GEN.species.get(toId(t) as never);
    if (s) return s.name;
  }
  return null;
}

let probeTarget: CalcMon | null = null;
const workable = new Map<string, boolean>();
/** Whether the calculator gives the move any damage (against Mew, which no type is immune to). */
function calcWorks(move: string): boolean {
  const known = workable.get(move);
  if (known !== undefined) return known;
  probeTarget ??= new CalcMon(CALC_GEN, "Mew", { level: 100, nature: "Hardy", evs: EVS, ivs: IVS });
  let ok = false;
  try {
    const a = new CalcMon(CALC_GEN, "Mew", { level: 100, nature: "Hardy", evs: EVS, ivs: IVS });
    const r = calculate(CALC_GEN, a, probeTarget, new Move(CALC_GEN, move), new Field({ gameType: "Singles" }));
    ok = r.range()[1] > 0;
  } catch {
    ok = false;
  }
  workable.set(move, ok);
  return ok;
}

/** Whether the battle can play a move (by name or id). */
export const playable = (name: string) => !unplayable(toId(name)) && (noCalc(moveRule(toId(name))) || calcWorks(Dex.moves.get(name).name));

// ---------------------------------------------------------------------------
// Learnsets
// ---------------------------------------------------------------------------

type LearnsetData = { learnset?: Record<string, string[]> };
const learnsetOf = (id: string): Record<string, string[]> => ((SimDex.species as unknown as { getLearnsetData(id: string): LearnsetData | undefined }).getLearnsetData(id)?.learnset ?? {});

/** A species' own learnset and its pre-evolutions', by move id (sources like "9L32", "9M", "8E"). */
function lineLearnset(showdownName: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let sp = Dex.species.get(showdownName);
  // A Mega or a battle-only form learns what its species does.
  if (!Object.keys(learnsetOf(sp.id)).length && sp.baseSpecies && sp.baseSpecies !== sp.name) {
    const base = Dex.species.get(sp.changesFrom ?? sp.baseSpecies);
    if (Object.keys(learnsetOf(base.id)).length) sp = base;
  }
  for (let guard = 0; sp?.exists && guard < 4; guard++) {
    for (const [move, sources] of Object.entries(learnsetOf(sp.id))) (out[move] ??= []).push(...sources);
    sp = sp.prevo ? Dex.species.get(sp.prevo) : (undefined as never);
  }
  return out;
}

/** The newest generation a learnset has moves in. */
function newestGen(ls: Record<string, string[]>): number {
  let g = 0;
  for (const sources of Object.values(ls)) for (const s of sources) g = Math.max(g, Number(s[0]) || 0);
  return g;
}

/** Every move a species can legally know (its newest generation's learnset, without event-only moves), by Showdown name. */
export function legalMoves(showdownName: string): string[] {
  const ls = lineLearnset(showdownName);
  const g = String(newestGen(ls));
  const out: string[] = [];
  for (const [id, sources] of Object.entries(ls)) if (sources.some((s) => s[0] === g && s[1] !== "S")) out.push(Dex.moves.get(id).name);
  return out;
}

/** Level-up moves (name, level) of a form, from Showdown's learnset in its newest generation (a Mega's are its species'). */
function formLevelUp(showdownName: string): [string, number][] {
  let sp = Dex.species.get(showdownName);
  if (!Object.keys(learnsetOf(sp.id)).length && sp.baseSpecies) sp = Dex.species.get(sp.changesFrom ?? sp.baseSpecies);
  const ls = learnsetOf(sp.id);
  // The newest generation it learns anything by levelling up in (a transfer-only generation has no level-up moves).
  let newest = 0;
  for (const sources of Object.values(ls)) for (const src of sources) if (/^\dL/.test(src)) newest = Math.max(newest, Number(src[0]));
  const g = String(newest);
  const out: [string, number][] = [];
  for (const [id, sources] of Object.entries(ls)) {
    for (const src of sources) {
      const m = /^(\d)L(\d+)$/.exec(src);
      if (m && m[1] === g) {
        const mv = Dex.moves.get(id);
        if (mv.category !== "Status") out.push([mv.name, Math.max(1, Number(m[2]))]);
        break;
      }
    }
  }
  return out;
}

/** Level-up attacking moves of a species (name, level), from its latest learnset in the Pokédex details. */
export function levelUpMoves(id: number): [string, number][] {
  const ls = DETAILS[String(id)]?.learnset;
  if (!ls) return [];
  const out: [string, number][] = [];
  for (const [moveId, method, at] of ls.moves) {
    if (method !== "L") continue;
    const raw = MOVES[String(moveId)];
    if (!raw || raw.cls === "status") continue;
    out.push([raw.name, Math.max(1, at)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

const abilityName = (slug: string) => {
  const a = Dex.abilities.get(slug);
  return a.exists ? a.name : slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
};

/** A Showdown species' abilities, the regular ones first. */
function dexAbilities(showdownName: string): string[] {
  const a = Dex.species.get(showdownName).abilities as unknown as Record<string, string | undefined>;
  return [a["0"], a["1"], a.H, a.S].filter((x): x is string => !!x);
}

interface Built {
  species: Omit<MBSpecies, "randbats" | "levelUp"> & { randbats: string[] | null; levelUp: [string, number][] };
}

function buildDefault(p: Pokemon): Built | null {
  const calc = calcName(p);
  const box = ART[String(p.id)];
  if (!calc || !box) return null;
  const set = knownSet(RANDSETS_FORMAT, p.name) ?? knownSet(RANDSETS_FORMAT, p.slug);
  const own = p.abilities.map((a) => abilityName(a.name));
  const regular = abilityName(p.abilities.find((a) => !a.hidden)?.name ?? p.abilities[0]?.name ?? "");
  const ability = set?.abilities[0] ?? regular;
  const abilities = [...new Set([ability, ...own, ...dexAbilities(calc)])].filter(Boolean);
  return {
    species: {
      id: p.id,
      of: p.id,
      slug: p.slug,
      name: p.name,
      calc,
      types: [...p.types],
      base: { ...p.stats },
      m: p.height / 10,
      kg: p.weight / 10,
      shape: p.shape,
      gen: p.gen,
      legendary: p.legendary,
      mythical: p.mythical,
      fullyEvolved: p.fullyEvolved,
      form: "",
      abilities,
      ability,
      item: set ? pickItem(set.items) : "",
      tera: set?.teraTypes ? [...set.teraTypes] : [],
      randbats: set ? [...set.moves] : null,
      levelUp: levelUpMoves(p.id),
      source: set ? "randbats" : "learnset",
      box: [...box] as MBSpecies["box"],
    },
  };
}

function buildForm(f: FormRow, base: Pokemon): Built | null {
  if (!BATTLE_FORMS.has(f.kind)) return null;
  const calc = formCalcName(f.slug);
  const box = ART[String(f.id)];
  if (!calc || !box) return null;
  const dex = Dex.species.get(calc);
  if (!dex.exists) return null;
  const types = dex.types.map((t) => t.toLowerCase());
  // The site's data and Showdown's must agree on what the form is.
  if (types.join("/") !== f.types.join("/")) return null;
  const own = knownSet(RANDSETS_FORMAT, calc);
  const mega = f.kind === "mega";
  const set = own ?? (mega ? knownSet(RANDSETS_FORMAT, base.name) : null);
  const abilities = dexAbilities(calc);
  const ability = mega ? abilities[0] : own?.abilities[0] ?? abilities[0] ?? "";
  const bs = dex.baseStats;
  return {
    species: {
      id: f.id,
      of: base.id,
      slug: f.slug,
      name: f.name,
      calc,
      types,
      base: { hp: bs.hp, atk: bs.atk, def: bs.def, spa: bs.spa, spd: bs.spd, spe: bs.spe },
      m: f.height / 10,
      kg: f.weight / 10,
      shape: base.shape,
      // A regional form belongs to the generation it arrived in (Alolan forms to 7…); a Mega to its species'.
      gen: FORM_GEN[formKind(f)] ?? base.gen,
      legendary: base.legendary,
      mythical: base.mythical,
      fullyEvolved: mega ? true : !dex.evos?.length,
      form: formKind(f),
      abilities: [...new Set([ability, ...abilities])].filter(Boolean),
      ability,
      // A Mega holds its Mega Stone; it can't hold anything else.
      item: mega ? "" : own ? pickItem(own.items) : "",
      tera: own?.teraTypes ? [...own.teraTypes] : [],
      randbats: set ? [...set.moves] : null,
      levelUp: mega ? levelUpMoves(base.id) : formLevelUp(calc),
      source: set ? "randbats" : "learnset",
      box: [...box] as MBSpecies["box"],
    },
  };
}

let cached: Roster | null = null;

/** Every Pokémon (and battle form) the battle can field, with its default set. */
export function buildRoster(): Roster {
  if (cached) return cached;
  const moves: MBMove[] = [];
  const index = new Map<string, number>();
  const ref = (name: string): number | null => {
    const d = Dex.moves.get(name);
    if (!d.exists || !playable(d.name)) return null;
    let i = index.get(d.name);
    if (i === undefined) {
      i = moves.length;
      moves.push(moveInfo(d.name));
      index.set(d.name, i);
    }
    return i;
  };
  const species: MBSpecies[] = [];
  const add = (b: Built | null) => {
    if (!b) return;
    const s = b.species;
    const randbats = s.randbats ? s.randbats.map(ref).filter((i): i is number => i !== null) : null;
    const seen = new Set<number>();
    const levelUp: [number, number][] = [];
    for (const [name, at] of s.levelUp) {
      const i = ref(name);
      if (i === null || seen.has(i)) continue;
      seen.add(i);
      levelUp.push([i, at]);
    }
    levelUp.sort((a, c) => a[1] - c[1] || a[0] - c[0]);
    species.push({ ...s, randbats: randbats && randbats.length ? randbats : null, levelUp, source: randbats && randbats.length ? "randbats" : "learnset" });
  };
  const byId = new Map(POKEDEX.map((p) => [p.id, p]));
  for (const p of POKEDEX) add(buildDefault(p));
  for (const f of FORMS) {
    const base = byId.get(f.species);
    if (base) add(buildForm(f, base));
  }
  // Every other move a species can learn, so a chosen set's moves are in the list (move indices are stable: defaults first).
  for (const s of species) for (const name of legalMoves(s.calc)) ref(name);
  cached = { version: ROSTER_VERSION, moves, species };
  return cached;
}

/** Every move each species can legally learn and the battle can play: species id → move indices (sorted by name). */
export function buildLearnsets(): Record<number, number[]> {
  const roster = buildRoster();
  const index = new Map(roster.moves.map((m, i) => [m.name, i]));
  const out: Record<number, number[]> = {};
  for (const s of roster.species) {
    const ids = new Set<number>();
    for (const name of legalMoves(s.calc)) {
      const i = index.get(name);
      if (i !== undefined) ids.add(i);
    }
    for (const [i] of s.levelUp) ids.add(i);
    for (const i of s.randbats ?? []) ids.add(i);
    out[s.id] = [...ids].sort((a, b) => roster.moves[a].name.localeCompare(roster.moves[b].name));
  }
  return out;
}

/** The roster as served: the same data, keyed for lookups. */
export const rosterById = () => new Map(buildRoster().species.map((s) => [s.id, s]));
