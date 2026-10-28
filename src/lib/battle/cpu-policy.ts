import { calculate, Field, Move as CalcMove, Pokemon as CalcMon } from "@smogon/calc";
import type { Battle, Pokemon, Side } from "@pkmn/sim";
import randsets from "@/data/battle/randsets.json";
import type { BattleRequest, CpuLevel } from "@/lib/battle/play";
import { forcedSwitchSlots, moveSlotOptions, randomChoice, teamChoice } from "./choices";
import { alive, calcGen, calcName, chooseCpuLegacy, field, hit, seededRandom, toCalc } from "./cpu-policy-legacy";

export { alive, calcGen, field, hit, seededRandom, toCalc };

/**
 * The computer opponent. Hard and Normal are a calc-based lookahead over an
 * approximate model of the position; Easy (and every double battle) is the
 * original greedy heuristic in cpu-policy-legacy.ts.
 *
 * - Set knowledge: in a Gen 9 random battle an unrevealed foe is assumed to
 *   have what Showdown's generator gives its species (src/data/battle/
 *   randsets.json: moves, ability, item, Tera types), narrowed by the moves
 *   it has shown. Elsewhere the old STAB guess stands in.
 * - Hard: two-ply. Each legal option (moves, Tera moves, switches) is played
 *   against every plausible player reply (their likely moves, or a switch to
 *   a Pokémon they have shown), the turn is resolved with the damage calc
 *   (order, KOs as probabilities, hazards, status, boosts, recoil, pivots,
 *   residual damage), and the resulting position is scored. The option with
 *   the best expected value over a reply distribution wins (replies weighted
 *   by how good they look to the player).
 * - Normal: the same model one ply deep (the player's single best reply),
 *   with noise.
 * - The position score is a win-probability proxy: each side's Pokémon
 *   weighted by HP and by how they fare one-on-one against what the other
 *   side has left (speed, priority, recovery, status counted), a penalty for
 *   each foe nothing of ours answers, the matchup of the two Pokémon in
 *   battle, hazards and a free switch for a side that must replace a
 *   fainted Pokémon. A doomed Pokémon that chips the foe is a fine trade,
 *   and with one Pokémon left each the score is that duel.
 *
 * It always returns an explicit, legal choice (built from the request).
 * Pure and isomorphic: no server or Node APIs.
 */

// ---------------------------------------------------------------------------
// Set knowledge
// ---------------------------------------------------------------------------

export interface SetKnowledge {
  level: number | null;
  abilities: string[];
  items: string[];
  moves: string[];
  teraTypes: string[];
}

const RANDSETS = (randsets as { formats: Record<string, Record<string, SetKnowledge>> }).formats;
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** What a random battle's `species` may carry, or null outside the formats the data covers. */
export function knownSet(formatid: string, species: string, baseSpecies?: string): SetKnowledge | null {
  const sets = RANDSETS[formatid];
  if (!sets) return null;
  return sets[toId(species)] ?? (baseSpecies ? sets[toId(baseSpecies)] : undefined) ?? null;
}

/** The random-battle set list a battle's format draws from, if the data has it. */
export function randsetsFormat(battle: Battle): string | null {
  const id = String(battle.format.id ?? "");
  if (!/random/.test(id) || battle.gen !== 9) return null;
  const key = battle.gameType === "doubles" ? "gen9randomdoublesbattle" : "gen9randombattle";
  return RANDSETS[key] ? key : null;
}

const STAB_GUESS: Record<string, [string, string]> = {
  Normal: ["Double-Edge", "Hyper Voice"],
  Fire: ["Flare Blitz", "Flamethrower"],
  Water: ["Liquidation", "Surf"],
  Grass: ["Wood Hammer", "Energy Ball"],
  Electric: ["Wild Charge", "Thunderbolt"],
  Ice: ["Icicle Crash", "Ice Beam"],
  Fighting: ["Close Combat", "Aura Sphere"],
  Poison: ["Gunk Shot", "Sludge Bomb"],
  Ground: ["Earthquake", "Earth Power"],
  Flying: ["Brave Bird", "Air Slash"],
  Psychic: ["Zen Headbutt", "Psychic"],
  Bug: ["U-turn", "Bug Buzz"],
  Rock: ["Stone Edge", "Power Gem"],
  Ghost: ["Poltergeist", "Shadow Ball"],
  Dragon: ["Outrage", "Draco Meteor"],
  Dark: ["Knock Off", "Dark Pulse"],
  Steel: ["Iron Head", "Flash Cannon"],
  Fairy: ["Play Rough", "Moonblast"],
  Stellar: ["Tera Blast", "Tera Blast"],
};

/** What we assume about a Pokémon on the other side: its likely moves (shown ones first), ability and item. */
export interface FoeProfile {
  moves: string[];
  /** How many of `moves` it has shown (they come first). */
  known: number;
  ability: string | undefined;
  item: string | undefined;
  fromSets: boolean;
}

export function foeProfile(battle: Battle, foe: Pokemon): FoeProfile {
  const known = foe.moveSlots.filter((m) => m.used).map((m) => m.move);
  const format = randsetsFormat(battle);
  const set = format ? knownSet(format, foe.species.name, foe.species.baseSpecies) : null;
  if (set) {
    const moves = known.length >= 4 ? known : [...known, ...set.moves.filter((m) => !known.includes(m))];
    // An empty item slot is public (Knock Off, a used berry); otherwise the set's item when there's only one
    // (a guess among several would skew every damage calc; TUNE.anyItem assumes the first regardless).
    const item = foe.item === "" && foe.lastItem ? undefined : set.items.length === 1 || TUNE.anyItem ? set.items[0] : undefined;
    return { moves, known: Math.min(4, known.length), ability: set.abilities[0], item, fromSets: true };
  }
  const physical = foe.species.baseStats.atk >= foe.species.baseStats.spa;
  const guesses = known.length >= 2 ? known : [...known, ...foe.getTypes().map((t) => (STAB_GUESS[t] ?? ["Tackle", "Swift"])[physical ? 0 : 1])];
  const moves = [...new Set(guesses)];
  // A STAB guess is a stand-in for a move it surely has.
  return { moves, known: moves.length, ability: undefined, item: undefined, fromSets: false };
}

// ---------------------------------------------------------------------------
// Move data
// ---------------------------------------------------------------------------

const SETUP = new Set(["swordsdance", "nastyplot", "dragondance", "calmmind", "quiverdance", "bulkup", "shellsmash", "agility", "irondefense", "coil", "victorydance", "tidyup", "shiftgear", "tailglow", "geomancy", "bellydrum", "filletaway", "curse", "workup", "growth", "honeclaws", "autotomize", "rockpolish", "cosmicpower", "stockpile", "clangoroussoul", "noretreat"]);
const RECOVERY = new Set(["recover", "roost", "slackoff", "softboiled", "moonlight", "synthesis", "morningsun", "shoreup", "milkdrink", "strengthsap", "wish", "rest", "junglehealing", "lunarblessing"]);
const HAZARDS: Record<string, keyof Hazards> = { stealthrock: "sr", spikes: "spikes", toxicspikes: "tspikes", stickyweb: "web", ceaselessedge: "spikes", stoneaxe: "sr" };
const CLEARERS = new Set(["defog", "rapidspin", "mortalspin", "tidyup"]);
const PROTECT = new Set(["protect", "detect", "spikyshield", "kingsshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct"]);
const PIVOT = new Set(["uturn", "voltswitch", "flipturn", "partingshot", "teleport", "chillyreception", "shedtail"]);
const UTILITY: Record<string, number> = { taunt: 0.02, encore: 0.03, substitute: 0.02, leechseed: 0.04, knockoff: 0, trick: 0.02, switcheroo: 0.02, haze: 0.02, whirlwind: 0.02, roar: 0.02, dragontail: 0, willowisp: 0, thunderwave: 0, toxic: 0, painsplit: 0.03, healingwish: 0.02 };

interface MoveInfo {
  id: string;
  name: string;
  attack: boolean;
  priority: number;
  acc: number;
  type: string;
  contact: boolean;
  recoil: number;
  drain: number;
  boosts?: Partial<Boosts>;
  selfBoosts?: Partial<Boosts>;
  status?: string;
  heal: number;
  hazard?: keyof Hazards;
  clears: boolean;
  protect: boolean;
  pivot: boolean;
  setup: boolean;
  recovery: boolean;
  utility: number;
  firstTurnOnly: boolean;
  sucker: boolean;
  sound: boolean;
  powder: boolean;
  /** A status the hit may leave (Scald's burn, Discharge's paralysis...), with its chance. */
  secondary?: { status: string; chance: number };
}

const moveInfos = new Map<string, MoveInfo>();
function moveInfo(battle: Battle, name: string): MoveInfo {
  const key = `${battle.gen}:${name}`;
  let info = moveInfos.get(key);
  if (info) return info;
  const m = battle.dex.moves.get(name);
  const id = m.id || toId(name);
  const self = (m.self as { boosts?: Partial<Boosts> } | undefined)?.boosts;
  const selfBoost = (m as { selfBoost?: { boosts?: Partial<Boosts> } }).selfBoost?.boosts;
  const secondaries = (m.secondaries ?? (m.secondary ? [m.secondary] : [])) as { chance?: number; status?: string }[];
  const secondary = secondaries.find((x) => typeof x.status === "string" && (x.chance ?? 0) >= 30);
  info = {
    id,
    name: m.exists ? m.name : name,
    attack: m.exists && m.category !== "Status",
    priority: m.priority ?? 0,
    acc: typeof m.accuracy === "number" ? m.accuracy / 100 : 1,
    type: m.type ?? "Normal",
    contact: !!m.flags?.contact,
    recoil: m.recoil ? m.recoil[0] / m.recoil[1] : id === "struggle" ? 0.25 : 0,
    drain: m.drain ? m.drain[0] / m.drain[1] : 0,
    boosts: m.target === "self" && m.boosts ? (m.boosts as Partial<Boosts>) : undefined,
    selfBoosts: self ?? selfBoost,
    status: typeof m.status === "string" ? m.status : undefined,
    heal: m.heal ? m.heal[0] / m.heal[1] : RECOVERY.has(id) ? 0.5 : 0,
    hazard: HAZARDS[id],
    clears: CLEARERS.has(id),
    protect: PROTECT.has(id),
    pivot: PIVOT.has(id) || !!m.selfSwitch,
    setup: SETUP.has(id) || (m.target === "self" && !!m.boosts && Object.values(m.boosts as Record<string, number>).some((b) => b > 0)),
    recovery: RECOVERY.has(id) || (!!m.heal && m.target === "self"),
    utility: UTILITY[id] ?? 0,
    firstTurnOnly: id === "fakeout" || id === "firstimpression",
    sucker: id === "suckerpunch" || id === "thunderclap",
    sound: !!m.flags?.sound,
    powder: !!m.flags?.powder,
    secondary: secondary ? { status: secondary.status!, chance: (secondary.chance ?? 0) / 100 } : undefined,
  };
  moveInfos.set(key, info);
  return info;
}

// ---------------------------------------------------------------------------
// The position model
// ---------------------------------------------------------------------------

type BoostId = "atk" | "def" | "spa" | "spd" | "spe";
type Boosts = Record<BoostId, number>;
const BOOST_IDS: BoostId[] = ["atk", "def", "spa", "spd", "spe"];
const NO_BOOSTS: Boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

interface Hazards {
  sr: boolean;
  spikes: number;
  tspikes: number;
  web: boolean;
}

/** One Pokémon as the model sees it. Replaced, never mutated, once a position is built. */
interface Mon {
  p: Pokemon;
  mine: boolean;
  revealed: boolean;
  hp: number; // fraction of max HP, 0 when fainted
  maxhp: number; // HP points the model works in
  status: string;
  boosts: Boosts;
  tera: string | undefined;
  moves: string[];
  /** The first `known` of `moves` are certain; the rest are candidates for the slots left (4 - known). */
  known: number;
  ability: string | undefined;
  item: string | undefined;
  types: string[];
  /** Everything a damage calc depends on (HP aside), and a short id for it. */
  key: string;
  kid: number;
  /** Stays in for this turn's hits (Protect). */
  protected?: boolean;
  seeded?: boolean;
}

interface SideState {
  mons: Mon[];
  /** Index into `mons` of the Pokémon in battle; -1 when a replacement is due (a free pick). */
  active: number;
  /** Pokémon the other side hasn't shown yet (counted at full health). */
  unseen: number;
  hazards: Hazards;
  canTera: boolean;
}

interface State {
  us: SideState;
  them: SideState;
}

interface Ctx {
  battle: Battle;
  gen: ReturnType<typeof calcGen>;
  side: Side;
  level: CpuLevel;
  fields: { ours: Field; theirs: Field; key: string };
  tailwind: [boolean, boolean]; // ours, theirs
  trickRoom: boolean;
  calcs: Map<string, CalcMon>;
  /** Best expected hit per (attacker, defender) key pair within this decision. */
  offense: Map<number, Offense>;
  evals: number;
}

/** Raw damage rolls, cached across turns (a damage calc doesn't depend on the defender's current HP). */
interface Raw {
  lo: number;
  hi: number;
}
const rawCache = new Map<string, Raw>();
const RAW_CACHE_MAX = 40_000;

/** Pokémon the computer has seen on the other side, per battle (unrevealed teammates are unknown in a random battle). */
const seen = new WeakMap<Battle, WeakSet<Pokemon>>();

function boostString(b: Boosts): string {
  return b.atk || b.def || b.spa || b.spd || b.spe ? `${b.atk},${b.def},${b.spa},${b.spd},${b.spe}` : "";
}

function monKey(m: Omit<Mon, "key" | "kid">): string {
  const set = m.mine ? `${m.p.set.nature || ""}/${Object.values(m.p.set.evs ?? {}).join(".")}/${Object.values(m.p.set.ivs ?? {}).join(".")}` : "r";
  return `${m.p.species.id}|${m.p.level}|${m.item ?? ""}|${m.ability ?? ""}|${set}|${m.status}|${boostString(m.boosts)}|${m.tera ?? ""}`;
}

const keyIds = new Map<string, number>();
function withKey(m: Omit<Mon, "key" | "kid">): Mon {
  const key = monKey(m);
  let kid = keyIds.get(key);
  if (kid === undefined) {
    if (keyIds.size >= RAW_CACHE_MAX) keyIds.clear();
    keyIds.set(key, (kid = keyIds.size + 1));
  }
  return { ...m, key, kid };
}

function revealedFoe(battle: Battle, p: Pokemon): boolean {
  if (p.isActive || p.fainted || p.hp < p.maxhp || !!p.status || p.moveSlots.some((m) => m.used)) return true;
  return seen.get(battle)?.has(p) ?? false;
}

function buildMon(ctx: Ctx, p: Pokemon, mine: boolean): Mon {
  const types = p.getTypes();
  if (mine) {
    const gen = ctx.gen.num;
    return withKey({
      p,
      mine,
      revealed: true,
      hp: p.fainted ? 0 : p.hp / p.maxhp,
      maxhp: p.maxhp,
      status: p.status || "",
      boosts: { atk: p.boosts.atk ?? 0, def: p.boosts.def ?? 0, spa: p.boosts.spa ?? 0, spd: p.boosts.spd ?? 0, spe: p.boosts.spe ?? 0 },
      tera: p.terastallized || undefined,
      moves: p.moveSlots.filter((m) => !m.disabled || !p.isActive).map((m) => m.move),
      known: 4,
      ability: gen >= 3 ? ctx.battle.dex.abilities.get(p.ability).name : undefined,
      item: p.item ? ctx.battle.dex.items.get(p.item).name : undefined,
      types,
    });
  }
  const profile = foeProfile(ctx.battle, p);
  const revealed = revealedFoe(ctx.battle, p);
  const maxhp = new CalcMon(ctx.gen, calcName(ctx.gen, p), { level: p.level, evs: { hp: 84 } }).maxHP();
  return withKey({
    p,
    mine,
    revealed,
    hp: p.fainted ? 0 : p.hp / p.maxhp,
    maxhp,
    status: p.status || "",
    boosts: { atk: p.boosts.atk ?? 0, def: p.boosts.def ?? 0, spa: p.boosts.spa ?? 0, spd: p.boosts.spd ?? 0, spe: p.boosts.spe ?? 0 },
    tera: p.terastallized || undefined,
    moves: profile.moves,
    known: profile.known,
    ability: profile.ability,
    item: profile.item,
    types,
  });
}

function hazardsOf(side: Side): Hazards {
  const sc = side.sideConditions as Record<string, { layers?: number } | undefined>;
  return { sr: !!sc.stealthrock, spikes: sc.spikes?.layers ?? 0, tspikes: sc.toxicspikes?.layers ?? 0, web: !!sc.stickyweb };
}

function buildState(ctx: Ctx): State {
  const { side } = ctx;
  const foe = side.foe;
  const ours = side.pokemon.map((p) => buildMon(ctx, p, true));
  const theirs = foe.pokemon.map((p) => buildMon(ctx, p, false)).filter((m) => m.revealed);
  const theirsAlive = theirs.filter((m) => m.hp > 0).length;
  const activeIndex = (mons: Mon[], active: Pokemon | null | undefined) => (alive(active) ? mons.findIndex((m) => m.p === active) : -1);
  return {
    us: { mons: ours, active: activeIndex(ours, side.active[0]), unseen: 0, hazards: hazardsOf(side), canTera: !!side.active[0]?.canTerastallize },
    them: { mons: theirs, active: activeIndex(theirs, foe.active[0]), unseen: Math.max(0, foe.pokemonLeft - theirsAlive), hazards: hazardsOf(foe), canTera: ctx.gen.num >= 9 && !foe.pokemon.some((p) => p.terastallized) },
  };
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

const NEUTRAL_EVS = { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 };

function calcMon(ctx: Ctx, m: Mon): CalcMon {
  let c = ctx.calcs.get(m.key);
  if (c) return c;
  const name = calcName(ctx.gen, m.p);
  const boosts = { ...m.boosts };
  c = m.mine
    ? new CalcMon(ctx.gen, name, {
        level: m.p.level,
        item: m.item as never,
        ability: m.ability as never,
        nature: (m.p.set.nature || "Hardy") as never,
        evs: m.p.set.evs,
        ivs: m.p.set.ivs,
        boosts,
        status: m.status as never,
        teraType: m.tera as never,
      })
    : new CalcMon(ctx.gen, name, {
        level: m.p.level,
        item: m.item as never,
        ability: (ctx.gen.num >= 3 ? m.ability : undefined) as never,
        nature: "Hardy",
        evs: NEUTRAL_EVS,
        boosts,
        status: m.status as never,
        teraType: m.tera as never,
      });
  ctx.calcs.set(m.key, c);
  return c;
}

const calcMoves = new Map<string, CalcMove>();

/** Damage rolls of `move` from `a` to `d` in HP points (0 when immune or unknown). */
function raw(ctx: Ctx, a: Mon, d: Mon, move: string): Raw {
  const key = `${ctx.gen.num}|${a.key}|${d.key}|${move}|${a.mine ? ctx.fields.key : ctx.fields.key + "~"}`;
  let r = rawCache.get(key);
  if (r) return r;
  try {
    const mkey = `${ctx.gen.num}:${move}`;
    let cm = calcMoves.get(mkey);
    if (!cm) calcMoves.set(mkey, (cm = new CalcMove(ctx.gen, move)));
    if (cm.category === "Status") r = { lo: 0, hi: 0 };
    else {
      const [lo, hi] = calculate(ctx.gen, calcMon(ctx, a), calcMon(ctx, d), cm, a.mine ? ctx.fields.ours : ctx.fields.theirs).range();
      // The calculator counts Triple Axel and Triple Kick at their first hit's power three times.
      const mult = cm.name === "Triple Axel" || cm.name === "Triple Kick" ? 2 : 1;
      r = { lo: lo * mult, hi: hi * mult };
    }
  } catch {
    r = { lo: 0, hi: 0 };
  }
  if (rawCache.size >= RAW_CACHE_MAX) rawCache.clear();
  rawCache.set(key, r);
  return r;
}

interface HitOutcome {
  /** Mean damage as a fraction of the defender's max HP, accuracy-weighted and capped at its current HP. */
  frac: number;
  /** Probability the hit faints the defender. */
  ko: number;
}

function expectHit(ctx: Ctx, a: Mon, d: Mon, info: MoveInfo): HitOutcome {
  if (!info.attack) return { frac: 0, ko: 0 };
  if (info.sound && d.ability === "Soundproof") return { frac: 0, ko: 0 };
  const { lo, hi } = raw(ctx, a, d, info.name);
  if (hi <= 0) return { frac: 0, ko: 0 };
  const hp = Math.max(1, Math.round(d.hp * d.maxhp));
  const mean = (lo + hi) / 2;
  const ko = lo >= hp ? info.acc : hi >= hp ? info.acc * ((hi - hp + 1) / (hi - lo + 1)) : 0;
  return { frac: (Math.min(mean, hp) / d.maxhp) * info.acc, ko };
}

interface Offense {
  /** Best expected fraction of the defender's max HP per turn. */
  frac: number;
  /** The best move's priority. */
  priority: number;
  move: string;
}

const NO_OFFENSE: Offense = { frac: 0, priority: 0, move: "" };

/** The chance one of a Pokémon's candidate moves (past the ones it has shown) is really in its set. */
function candidateChance(m: Mon): number {
  const unknown = m.moves.length - m.known;
  return unknown <= 0 ? 1 : Math.min(1, Math.max(0, 4 - m.known) / unknown);
}

/**
 * The hardest `a` hits `d` (fraction of d's max HP per turn, HP-independent): the best of the moves it has
 * shown, or the expected best of its candidates (each in the set with the same chance, best first).
 */
function offense(ctx: Ctx, a: Mon, d: Mon): Offense {
  const key = a.kid * 1_048_576 + d.kid;
  const cached = ctx.offense.get(key);
  if (cached) return cached;
  let o: Offense = NO_OFFENSE;
  const candidates: Offense[] = [];
  a.moves.forEach((name, i) => {
    const info = moveInfo(ctx.battle, name);
    if (!info.attack || info.firstTurnOnly) return;
    const { lo, hi } = raw(ctx, a, d, info.name);
    if (hi <= 0) return;
    let frac = (((lo + hi) / 2) * info.acc) / d.maxhp;
    if (info.sucker) frac *= 0.6; // Only lands on an attack.
    const hit = { frac: Math.min(1, frac), priority: info.priority, move: info.name };
    if (i < a.known) {
      if (frac > o.frac) o = hit;
    } else candidates.push(hit);
  });
  if (candidates.length) {
    const p = candidateChance(a);
    candidates.sort((x, y) => y.frac - x.frac);
    let frac = 0;
    let left = 1;
    for (const c of candidates) {
      if (c.frac <= o.frac) break;
      frac += left * p * (c.frac - o.frac);
      left *= 1 - p;
    }
    if (frac > 0) o = { frac: o.frac + frac, priority: candidates[0].priority, move: candidates[0].move };
  }
  ctx.offense.set(key, o);
  return o;
}

const BOOST_MULT = [2 / 8, 2 / 7, 2 / 6, 2 / 5, 2 / 4, 2 / 3, 1, 3 / 2, 2, 5 / 2, 3, 7 / 2, 4];

function speedOf(ctx: Ctx, m: Mon): number {
  let spe = calcMon(ctx, m).stats.spe * BOOST_MULT[Math.max(0, Math.min(12, m.boosts.spe + 6))];
  if (m.status === "par") spe *= ctx.gen.num >= 7 ? 0.5 : 0.25;
  if (m.item === "Choice Scarf") spe *= 1.5;
  if (m.item === "Iron Ball") spe *= 0.5;
  if (ctx.tailwind[m.mine ? 0 : 1]) spe *= 2;
  const weather = ctx.battle.field.weather;
  if ((m.ability === "Swift Swim" && weather === "raindance") || (m.ability === "Chlorophyll" && weather === "sunnyday") || (m.ability === "Sand Rush" && weather === "sandstorm") || (m.ability === "Slush Rush" && (weather === "snowscape" || weather === "hail"))) spe *= 2;
  return ctx.trickRoom ? 10000 - spe : spe;
}

/** Does `a` move before `d`? (ties go to the other side: the computer doesn't gamble on them) */
function faster(ctx: Ctx, a: Mon, d: Mon): boolean {
  const sa = speedOf(ctx, a);
  const sd = speedOf(ctx, d);
  return a.mine ? sa > sd : sa >= sd;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** The evaluation's weights (the benchmark tunes them; they're not meant to be changed at runtime). */
export const TUNE = { kMargin: 1.6, monBase: 0.4, hpPow: 0.75, fitWeight: 0.9, hpWeight: 0.75, frontCost: 0.22, unanswered: 1.2, front: 0.45, tempo: 0.45, tera: 0.08, scaleEnd: 1.3, scale: 0.8, replyTemp: 0.3, switchCost: 0.015, discrete: 0, anyItem: 1, healAt: 0.5, recoverCost: 0.03, followups: 3 };

/** How much of a turn's damage a Pokémon's recovery undoes over time (Rest costs the turns asleep). */
function recoveryOf(ctx: Ctx, m: Mon): number {
  let best = 0;
  for (const n of m.moves) {
    const info = moveInfo(ctx.battle, n);
    if (info.recovery) best = Math.max(best, info.id === "rest" ? 0.3 : 0.5);
  }
  return best;
}

/** Probability `a` wins a duel against `d` from their current HP, roughly. */
function duel(ctx: Ctx, a: Mon, d: Mon): number {
  if (a.hp <= 0) return 0;
  if (d.hp <= 0) return 1;
  const oa = offense(ctx, a, d);
  const od = offense(ctx, d, a);
  const residual = (m: Mon) => (m.status === "psn" || m.status === "tox" ? 0.11 : m.status === "brn" ? 0.0625 : 0) + (m.seeded ? 0.125 : 0) - (m.item === "Leftovers" || m.item === "Black Sludge" ? 0.0625 : 0);
  const act = (m: Mon) => (m.status === "slp" ? 0.4 : m.status === "frz" ? 0.3 : m.status === "par" ? 0.75 : 1);
  // Per turn: what each takes from the other, less what it heals.
  const inA = Math.max(0.01, od.frac * act(d) + residual(a) - Math.min(0.25, od.frac * recoveryOf(ctx, a)));
  const inD = Math.max(0.01, oa.frac * act(a) + residual(d) - Math.min(0.25, oa.frac * recoveryOf(ctx, d)));
  // Turns each needs to KO the other: whole turns matter most (a 2HKO beats a 3HKO), the fraction a little
  // (chip damage that brings the next hit into KO range counts).
  const turnsA = d.hp / inD;
  const turnsD = a.hp / inA;
  let first = faster(ctx, a, d);
  if (oa.priority > od.priority && oa.frac >= d.hp) first = true;
  else if (od.priority > oa.priority && od.frac >= a.hp) first = false;
  const whole = Math.ceil(turnsD - 1e-6) - Math.ceil(turnsA - 1e-6);
  const margin = TUNE.discrete * whole + (1 - TUNE.discrete) * (turnsD - turnsA) + (first ? 0.5 : -0.5);
  return sigmoid(TUNE.kMargin * margin);
}

const HAZARD_VALUE = (h: Hazards, benched: number) => benched * ((h.sr ? 0.045 : 0) + h.spikes * 0.03 + (h.tspikes ? 0.025 : 0) + (h.web ? 0.03 : 0));

function sideValue(ctx: Ctx, mine: SideState, theirs: SideState): { value: number; unanswered: number } {
  const foes = theirs.mons.filter((m) => m.hp > 0);
  let value = 0;
  for (const m of mine.mons) {
    if (m.hp <= 0) continue;
    // How it fares against what they have left, each foe counting by its health (a foe about to drop
    // hardly matters) and the Pokémon they haven't shown counting as even.
    let sum = 0.5 * (theirs.unseen + 0.25);
    let weight = theirs.unseen + 0.25;
    for (const f of foes) {
      const w = f.hp;
      sum += w * duel(ctx, m, f);
      weight += w;
    }
    const fit = sum / weight;
    // A Pokémon standing is worth something on its own (a free switch at the least), the rest by its
    // health weighted by how useful it is against what they have left.
    value += TUNE.monBase + Math.pow(m.hp, TUNE.hpPow) * (TUNE.hpWeight + TUNE.fitWeight * (fit - 0.5));
  }
  value += mine.unseen * 1.0;
  // Foes nothing of ours handles well: a standing threat (a teammate not shown yet counts as an even match).
  let unanswered = 0;
  const ours = mine.mons.filter((m) => m.hp > 0);
  for (const f of foes) {
    let best = mine.unseen ? 0.5 : 0;
    for (const m of ours) best = Math.max(best, duel(ctx, m, f));
    unanswered += f.hp * Math.max(0, 0.6 - best);
  }
  return { value, unanswered };
}

/** The best a side could put in front of `foe`: its active as is, a bench Pokémon at the price of a switch. */
function frontValue(ctx: Ctx, side: SideState, foe: Mon): number {
  let best = 0;
  side.mons.forEach((m, i) => {
    if (m.hp <= 0) return;
    const cost = side.active < 0 ? 0 : i === side.active ? 0 : TUNE.frontCost;
    best = Math.max(best, duel(ctx, m, foe) - cost);
  });
  return best;
}

/** The position's value for us: a win-probability proxy in (0, 1). */
function evaluate(ctx: Ctx, s: State): number {
  ctx.evals++;
  const usLeft = s.us.mons.filter((m) => m.hp > 0).length;
  const themLeft = s.them.mons.filter((m) => m.hp > 0).length + s.them.unseen;
  if (!usLeft) return 0;
  if (!themLeft) return 1;
  const a = sideValue(ctx, s.us, s.them);
  const b = sideValue(ctx, s.them, s.us);
  let diff = a.value - b.value - TUNE.unanswered * a.unanswered + TUNE.unanswered * b.unanswered;

  // Who's in front: each side's best answer to the other's active, a switch costing a turn of hits
  // (a side replacing a fainted Pokémon picks for free, but it lost the Pokémon).
  // A Pokémon about to drop is no advantage to face (its KO is already counted), nor a disadvantage.
  // A side that gets a free replacement picks its answer, and the other side then answers that: a wash.
  const ourActive = s.us.active >= 0 ? s.us.mons[s.us.active] : null;
  const theirActive = s.them.active >= 0 ? s.them.mons[s.them.active] : null;
  if (ourActive && theirActive) {
    const unknown = s.them.unseen ? 0.5 : 0;
    const w = Math.min(1, 2 * Math.min(ourActive.hp, theirActive.hp));
    const front = frontValue(ctx, s.us, theirActive) - Math.max(unknown, frontValue(ctx, s.them, ourActive));
    diff += w * (TUNE.front * front + TUNE.tempo * (duel(ctx, ourActive, theirActive) - 0.5));
  }

  diff += HAZARD_VALUE(s.them.hazards, themLeft - 1) - HAZARD_VALUE(s.us.hazards, usLeft - 1);
  // Terastallization still in hand is worth keeping.
  if (s.us.canTera) diff += TUNE.tera;
  if (s.them.canTera) diff -= TUNE.tera;
  // Close to the end, the duel decides.
  const scale = usLeft + themLeft <= 3 ? TUNE.scaleEnd : TUNE.scale;
  return sigmoid(scale * diff);
}

// ---------------------------------------------------------------------------
// Turn resolution
// ---------------------------------------------------------------------------

type Action = { kind: "move"; move: string; tera?: boolean } | { kind: "switch"; to: number };

interface Leaf {
  w: number;
  s: State;
}

function replaceMon(side: SideState, i: number, m: Mon): SideState {
  const mons = side.mons.slice();
  mons[i] = m;
  return { ...side, mons };
}

function update(s: State, mine: boolean, side: SideState): State {
  return mine ? { ...s, us: side } : { ...s, them: side };
}

function patch(m: Mon, changes: Partial<Mon>): Mon {
  const next = { ...m, ...changes };
  return "status" in changes || "boosts" in changes || "tera" in changes || "item" in changes ? withKey(next) : next;
}

const TYPE_CHART_SR: Record<string, number> = { Fire: 2, Flying: 2, Bug: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Steel: 0.5 };

function grounded(m: Mon): boolean {
  return !m.types.includes("Flying") && m.ability !== "Levitate" && m.item !== "Air Balloon";
}

/** Brings `to` into battle for a side: hazards bite, boosts and volatiles go. */
function switchIn(ctx: Ctx, s: State, mine: boolean, to: number): State {
  const side = mine ? s.us : s.them;
  let m = side.mons[to];
  if (m.hp <= 0) return s;
  let loss = 0;
  if (side.hazards.sr && m.item !== "Heavy-Duty Boots") {
    let mult = 1;
    for (const t of m.tera ? [m.tera] : m.types) mult *= TYPE_CHART_SR[t] ?? 1;
    loss += mult / 8;
  }
  let status = m.status;
  if (grounded(m) && m.item !== "Heavy-Duty Boots") {
    if (side.hazards.spikes) loss += [0, 1 / 8, 1 / 6, 1 / 4][Math.min(3, side.hazards.spikes)];
    if (side.hazards.tspikes && !status && !m.types.includes("Poison") && !m.types.includes("Steel")) status = side.hazards.tspikes >= 2 ? "tox" : "psn";
  }
  let hazards = side.hazards;
  if (side.hazards.tspikes && grounded(m) && m.types.includes("Poison")) hazards = { ...hazards, tspikes: 0 };
  const hp = Math.max(0, m.hp - loss);
  m = patch(m, { hp, status, boosts: NO_BOOSTS, protected: false, seeded: false });
  const next = replaceMon(side, to, m);
  return update(s, mine, { ...next, active: hp > 0 ? to : -1, hazards });
}

function activeOf(s: State, mine: boolean): Mon | null {
  const side = mine ? s.us : s.them;
  return side.active >= 0 ? side.mons[side.active] : null;
}

function setActive(s: State, mine: boolean, m: Mon): State {
  const side = mine ? s.us : s.them;
  return update(s, mine, replaceMon(side, side.active, m));
}

function addBoosts(b: Boosts, delta: Partial<Boosts>): Boosts {
  const out = { ...b };
  for (const id of BOOST_IDS) if (delta[id]) out[id] = Math.max(-6, Math.min(6, out[id] + (delta[id] ?? 0)));
  return out;
}

function immuneToStatus(m: Mon, status: string, info: MoveInfo): boolean {
  if (m.status) return true;
  if (info.powder && (m.types.includes("Grass") || m.ability === "Overcoat")) return true;
  switch (status) {
    case "brn":
      return m.types.includes("Fire") || m.ability === "Water Veil" || m.ability === "Thermal Exchange";
    case "par":
      return m.types.includes("Electric") || m.ability === "Limber" || (info.type === "Electric" && m.types.includes("Ground"));
    case "psn":
    case "tox":
      return m.types.includes("Poison") || m.types.includes("Steel") || m.ability === "Immunity";
    case "slp":
      return m.ability === "Insomnia" || m.ability === "Vital Spirit" || m.ability === "Sweet Veil";
    default:
      return false;
  }
}

/** The type a Pokémon would Terastallize into: ours as set, theirs the set list's first (or its own first type). */
function teraTypeOf(ctx: Ctx, m: Mon): string {
  if (m.mine) return m.p.teraType || m.types[0];
  const format = randsetsFormat(ctx.battle);
  const set = format ? knownSet(format, m.p.species.name, m.p.species.baseSpecies) : null;
  return set?.teraTypes[0] ?? m.types[0];
}

/** `user`'s side uses `move` on the other side's active Pokémon. Returns the weighted outcomes. */
function playMove(ctx: Ctx, s: State, mine: boolean, info: MoveInfo, tera: boolean, foeAction: Action): Leaf[] {
  let user = activeOf(s, mine);
  if (!user || user.hp <= 0) return [{ w: 1, s }];
  if (tera) {
    user = patch(user, { tera: teraTypeOf(ctx, user) });
    s = setActive(s, mine, user);
    s = update(s, mine, { ...(mine ? s.us : s.them), canTera: false });
  }
  const target = activeOf(s, !mine);

  // Status moves.
  if (!info.attack) {
    if (info.protect) {
      if (PROTECT.has(user.p.lastMove?.id ?? "") && user.p.isActive) return [{ w: 1, s }];
      return [{ w: 1, s: setActive(s, mine, patch(user, { protected: true })) }];
    }
    if (info.setup && info.boosts) {
      let hp = user.hp;
      if (info.id === "bellydrum" || info.id === "filletaway") {
        if (hp <= 0.5) return [{ w: 1, s }];
        hp -= 0.5;
      }
      return [{ w: 1, s: setActive(s, mine, patch(user, { boosts: addBoosts(user.boosts, info.boosts), hp })) }];
    }
    if (info.recovery) {
      // Healing when barely hurt wastes the turn (Rest wastes two more); the model doesn't look that far.
      if (user.hp > TUNE.healAt || (info.id === "rest" && user.status === "slp")) return [{ w: 1, s }];
      const status = info.id === "rest" ? "slp" : user.status;
      return [{ w: 1, s: setActive(s, mine, patch(user, { hp: Math.min(1, user.hp + (info.id === "rest" ? 1 : info.heal || 0.5)), status })) }];
    }
    if (info.hazard) {
      const foeSide = mine ? s.them : s.us;
      const h = { ...foeSide.hazards };
      if (info.hazard === "spikes") h.spikes = Math.min(3, h.spikes + 1);
      else if (info.hazard === "tspikes") h.tspikes = Math.min(2, h.tspikes + 1);
      else h[info.hazard] = true;
      return [{ w: 1, s: update(s, !mine, { ...foeSide, hazards: h }) }];
    }
    if (info.clears) {
      const own = mine ? s.us : s.them;
      let next = update(s, mine, { ...own, hazards: { sr: false, spikes: 0, tspikes: 0, web: false } });
      if (info.id === "defog") {
        const foeSide = mine ? next.them : next.us;
        next = update(next, !mine, { ...foeSide, hazards: { sr: false, spikes: 0, tspikes: 0, web: false } });
      }
      return [{ w: 1, s: next }];
    }
    if (info.status && target && target.hp > 0 && !target.protected) {
      if (immuneToStatus(target, info.status, info)) return [{ w: 1, s }];
      const landed = setActive(s, !mine, patch(target, { status: info.status }));
      return info.acc >= 1 ? [{ w: 1, s: landed }] : [{ w: info.acc, s: landed }, { w: 1 - info.acc, s }];
    }
    if (info.id === "leechseed" && target && target.hp > 0 && !target.protected && !target.types.includes("Grass") && !target.seeded) return [{ w: 1, s: setActive(s, !mine, patch(target, { seeded: true })) }];
    if (info.pivot) {
      const side = mine ? s.us : s.them;
      if (!side.mons.some((m, i) => i !== side.active && m.hp > 0)) return [{ w: 1, s }];
      return [{ w: 1, s: update(s, mine, { ...side, active: -1 }) }];
    }
    return [{ w: 1, s }];
  }

  // Attacks.
  if (!target || target.hp <= 0 || target.protected) return [{ w: 1, s }];
  if (info.firstTurnOnly && user.mine && user.p.activeMoveActions > 0) return [{ w: 1, s }];
  if (info.sucker && (foeAction.kind !== "move" || !moveInfo(ctx.battle, foeAction.move).attack)) return [{ w: 1, s }];
  const h = expectHit(ctx, user, target, info);
  if (h.frac <= 0 && h.ko <= 0) return [{ w: 1, s }];
  const after = (dealt: number, koed: boolean, status?: string): State => {
    let next = s;
    const foeSide = mine ? next.them : next.us;
    const victim = patch(target, { hp: koed ? 0 : Math.max(0.01, target.hp - dealt), status: status ?? target.status });
    next = update(next, !mine, { ...replaceMon(foeSide, foeSide.active, victim), active: koed ? -1 : foeSide.active });
    // The user: recoil, drain, stat drops, a pivot out.
    let me = activeOf(next, mine)!;
    let hp = me.hp;
    if (info.recoil) hp -= (dealt * target.maxhp * info.recoil) / me.maxhp;
    if (info.drain) hp += (dealt * target.maxhp * info.drain) / me.maxhp;
    if (me.item === "Life Orb") hp -= 0.1;
    if (info.contact && target.item === "Rocky Helmet") hp -= 1 / 6;
    if (info.contact && target.ability === "Rough Skin") hp -= 1 / 8;
    hp = Math.max(0, Math.min(1, hp));
    me = patch(me, { hp, boosts: info.selfBoosts ? addBoosts(me.boosts, info.selfBoosts) : me.boosts });
    const ownSide = mine ? next.us : next.them;
    const bench = ownSide.mons.some((m, i) => i !== ownSide.active && m.hp > 0);
    next = update(next, mine, { ...replaceMon(ownSide, ownSide.active, me), active: hp <= 0 ? -1 : info.pivot && bench ? -1 : ownSide.active });
    return next;
  };
  if (h.ko >= 0.999) return [{ w: 1, s: after(target.hp, true) }];
  // Damage on the no-KO branch: the mean roll, capped just below the target's HP.
  const dealt = Math.min(h.frac, target.hp - 0.01);
  const survived: Leaf[] = [];
  const sec = info.secondary;
  if (sec && !immuneToStatus(target, sec.status, info) && target.ability !== "Shield Dust") {
    survived.push({ w: sec.chance, s: after(dealt, false, sec.status) }, { w: 1 - sec.chance, s: after(dealt, false) });
  } else survived.push({ w: 1, s: after(dealt, false) });
  if (h.ko <= 0.001) return survived;
  return [{ w: h.ko, s: after(target.hp, true) }, ...survived.map((l) => ({ w: l.w * (1 - h.ko), s: l.s }))];
}

function endOfTurn(s: State): State {
  for (const mine of [true, false]) {
    const m = activeOf(s, mine);
    if (!m || m.hp <= 0) continue;
    let hp = m.hp;
    if (m.status === "psn") hp -= 1 / 8;
    else if (m.status === "tox") hp -= 1 / 8;
    else if (m.status === "brn") hp -= 1 / 16;
    if (m.seeded) hp -= 1 / 8;
    if (m.item === "Leftovers" || (m.item === "Black Sludge" && m.types.includes("Poison"))) hp += 1 / 16;
    hp = Math.max(0, Math.min(1, hp));
    if (hp !== m.hp || m.protected) {
      const side = mine ? s.us : s.them;
      s = update(s, mine, { ...replaceMon(side, side.active, patch(m, { hp, protected: false })), active: hp > 0 ? side.active : -1 });
    }
  }
  return s;
}

function actionPriority(ctx: Ctx, m: Mon, a: Action): number {
  if (a.kind === "switch") return 6;
  const info = moveInfo(ctx.battle, a.move);
  let p = info.priority;
  if (!info.attack && m.ability === "Prankster") p += 1;
  if (info.id === "grassyglide" && ctx.battle.field.terrain === "grassyterrain") p += 1;
  return p;
}

/** The turn after both choices: weighted resulting positions. */
function resolveTurn(ctx: Ctx, start: State, ours: Action, theirs: Action): Leaf[] {
  let s = start;
  if (ours.kind === "switch") s = switchIn(ctx, s, true, ours.to);
  if (theirs.kind === "switch") s = switchIn(ctx, s, false, theirs.to);
  const us = activeOf(s, true);
  const them = activeOf(s, false);
  const order: boolean[] = []; // true: our move
  if (ours.kind === "move" && theirs.kind === "move" && us && them) {
    const pu = actionPriority(ctx, us, ours);
    const pt = actionPriority(ctx, them, theirs);
    const usFirst = pu !== pt ? pu > pt : faster(ctx, us, them);
    order.push(usFirst, !usFirst);
  } else if (ours.kind === "move") order.push(true);
  else if (theirs.kind === "move") order.push(false);

  let leaves: Leaf[] = [{ w: 1, s }];
  for (const mine of order) {
    const action = mine ? ours : theirs;
    if (action.kind !== "move") continue;
    const info = moveInfo(ctx.battle, action.move);
    const next: Leaf[] = [];
    for (const leaf of leaves) {
      const actor = activeOf(leaf.s, mine);
      if (!actor || actor.hp <= 0) {
        next.push(leaf);
        continue;
      }
      // Asleep or frozen, it mostly doesn't move (Sleep Talk calls its best attack).
      let used = info;
      let pAct = 1;
      if (actor.status === "slp") {
        const target = activeOf(leaf.s, !mine);
        const best = target && target.hp > 0 ? offense(ctx, actor, target).move : "";
        if (info.id === "sleeptalk" && best) used = moveInfo(ctx.battle, best);
        else pAct = 0.33;
      } else if (actor.status === "frz") pAct = 0.2;
      if (pAct < 1) next.push({ w: leaf.w * (1 - pAct), s: leaf.s });
      for (const out of playMove(ctx, leaf.s, mine, used, !!action.tera, mine ? theirs : ours)) next.push({ w: leaf.w * out.w * pAct, s: out.s });
    }
    leaves = next;
  }
  return leaves.map((l) => ({ w: l.w, s: endOfTurn(l.s) }));
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

interface Reply {
  action: Action;
  w: number;
}

/** How the player's active Pokémon would like its options: a one-ply look from their side. */
function replyDistribution(ctx: Ctx, s: State, full: boolean): Reply[] {
  const them = activeOf(s, false);
  const us = activeOf(s, true);
  if (!them || !us) return [{ action: { kind: "move", move: "Tackle" }, w: 1 }];
  const scored: { action: Action; score: number; chance: number }[] = [];
  const chance = candidateChance(them);
  them.moves.forEach((name, i) => {
    const info = moveInfo(ctx.battle, name);
    let score: number;
    if (info.attack) {
      const h = expectHit(ctx, them, us, info);
      score = h.frac + h.ko * 0.8 + (h.ko > 0.3 && info.priority > 0 ? 0.3 : 0);
      if (info.firstTurnOnly) score = them.p.activeMoveActions > 0 ? -1 : score + 0.1;
    } else {
      const incoming = offense(ctx, us, them).frac;
      if (info.setup) score = incoming < 0.3 && them.hp > 0.5 ? 0.45 : 0;
      else if (info.recovery) score = them.hp < 0.5 && incoming < 0.5 ? 0.45 : -0.2;
      else if (info.hazard) score = (them.mine ? s.them : s.us).hazards[info.hazard] ? -0.5 : 0.3;
      else if (info.status) score = immuneToStatus(us, info.status, info) ? -0.5 : 0.35;
      else if (info.protect) score = -0.2;
      else score = 0.1;
    }
    scored.push({ action: { kind: "move", move: info.name }, score, chance: i < them.known ? 1 : chance });
  });
  if (full) {
    // A switch when the matchup is bad (to a Pokémon it has shown us).
    const stay = duel(ctx, them, us);
    s.them.mons.forEach((m, i) => {
      if (i === s.them.active || m.hp <= 0) return;
      const d = duel(ctx, m, us);
      scored.push({ action: { kind: "switch", to: i }, score: d - 0.5 - (stay > 0.5 ? 0.45 : 0.15), chance: 1 });
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = full ? scored.slice(0, 5) : scored.slice(0, 1);
  const best = top[0]?.score ?? 0;
  const replies: Reply[] = [];
  let total = 0;
  for (const r of top) {
    if (r.score < best - 0.6) continue;
    const w = r.chance * Math.exp((r.score - best) / TUNE.replyTemp);
    replies.push({ action: r.action, w });
    total += w;
  }
  for (const r of replies) r.w /= total;
  return replies;
}

function expectedValue(ctx: Ctx, s: State, ours: Action, replies: Reply[], value: (s: State) => number = (leaf) => evaluate(ctx, leaf)): number {
  let ev = 0;
  for (const r of replies) {
    let v = 0;
    for (const leaf of resolveTurn(ctx, s, ours, r.action)) v += leaf.w * value(leaf.s);
    ev += r.w * v;
  }
  return ev;
}

/** Fills an empty slot after a KO or a pivot: ours by the position's value, theirs by the duel against our active. */
function settle(ctx: Ctx, s: State): State {
  if (s.us.active < 0) {
    let best = -1;
    let bestScore = -Infinity;
    s.us.mons.forEach((m, i) => {
      if (m.hp <= 0) return;
      const score = evaluate(ctx, switchIn(ctx, s, true, i));
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    if (best < 0) return s;
    s = switchIn(ctx, s, true, best);
  }
  if (s.them.active < 0) {
    const ours = activeOf(s, true);
    let best = -1;
    let bestScore = -Infinity;
    s.them.mons.forEach((m, i) => {
      if (m.hp <= 0) return;
      const score = ours ? duel(ctx, m, ours) : m.hp;
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    if (best >= 0) s = switchIn(ctx, s, false, best);
  }
  return s;
}

/** Our options from a modelled position (the request isn't there to ask): the active's moves, Tera, switches. */
function modelOptions(s: State): Action[] {
  const me = activeOf(s, true);
  const out: Action[] = [];
  if (me) {
    for (const move of me.moves) {
      out.push({ kind: "move", move });
      if (s.us.canTera && !me.tera) out.push({ kind: "move", move, tera: true });
    }
  }
  s.us.mons.forEach((m, i) => {
    if (i !== s.us.active && m.hp > 0) out.push({ kind: "switch", to: i });
  });
  return out;
}

/** A position's value one turn further on: our best option against the player's single most likely reply. */
function followup(ctx: Ctx, leaf: State): number {
  const s = settle(ctx, leaf);
  const me = activeOf(s, true);
  const them = activeOf(s, false);
  if (!me || !them) return evaluate(ctx, s);
  const replies = replyDistribution(ctx, s, false);
  let best = -Infinity;
  for (const action of modelOptions(s)) {
    let v = expectedValue(ctx, s, action, replies);
    if (action.kind === "switch") v -= TUNE.switchCost;
    if (action.kind === "move" && action.tera) v -= 0.01;
    if (v > best) best = v;
  }
  return best === -Infinity ? evaluate(ctx, s) : best;
}

const NOISE: Record<CpuLevel, number> = { easy: 0, normal: 0.09, hard: 0 };

const isNoop = (info: MoveInfo) => !info.attack && !info.setup && !info.recovery && !info.hazard && !info.clears && !info.status && !info.protect && !info.pivot && info.id !== "leechseed";

function makeCtx(battle: Battle, side: Side, level: CpuLevel): Ctx {
  const ours = field(battle, false, side);
  const theirs = field(battle, false, side.foe);
  const fkey = `${battle.field.weather}|${battle.field.terrain}|${Object.keys(battle.field.pseudoWeather).join(",")}|${Object.keys(side.sideConditions).join(",")}|${Object.keys(side.foe.sideConditions).join(",")}|${battle.sides.flatMap((x) => x.active.map((p) => (alive(p) ? p.ability : ""))).join(",")}`;
  return {
    battle,
    gen: calcGen(battle),
    side,
    level,
    fields: { ours, theirs, key: fkey },
    tailwind: [!!side.sideConditions.tailwind, !!side.foe.sideConditions.tailwind],
    trickRoom: !!battle.field.pseudoWeather.trickroom,
    calcs: new Map(),
    offense: new Map(),
    evals: 0,
  };
}

function noteSeen(battle: Battle, side: Side) {
  let set = seen.get(battle);
  if (!set) seen.set(battle, (set = new WeakSet()));
  for (const p of side.foe.active) if (p) set.add(p);
}

/** The computer's choice for `side`. `rand` drives the noise; `onError` hears about a fallback. */
export function chooseCpu(
  battle: Battle,
  side: Side,
  level: CpuLevel,
  rand: () => number,
  onError: (err: unknown) => void = (err) => console.error("[battle] cpu fell back to a random choice:", err)
): string {
  const request = side.activeRequest as unknown as BattleRequest | null;
  if (!request || request.wait) throw new Error("The computer has nothing to choose.");
  if (level === "easy" || battle.gameType !== "singles") return chooseCpuLegacy(battle, side, level, rand, onError);
  noteSeen(battle, side);
  try {
    return decide(makeCtx(battle, side, level), request, rand);
  } catch (err) {
    onError(err);
    try {
      return chooseCpuLegacy(battle, side, level, rand, () => undefined);
    } catch {
      return randomChoice(request, false, rand);
    }
  }
}

function decide(ctx: Ctx, request: BattleRequest, rand: () => number): string {
  const { side, level } = ctx;
  const noise = NOISE[level];
  const jitter = () => (rand() - 0.5) * noise;
  const s = buildState(ctx);

  if (request.teamPreview) {
    // Lead with the Pokémon that duels their team best (their team is in view).
    const theirs = side.foe.pokemon.map((p) => buildMon(ctx, p, false));
    let best = 1;
    let bestScore = -Infinity;
    s.us.mons.forEach((m, i) => {
      let sum = 0;
      for (const f of theirs) sum += duel(ctx, m, f);
      const score = sum / Math.max(1, theirs.length) + jitter();
      if (score > bestScore) [best, bestScore] = [i + 1, score];
    });
    return teamChoice(request, best);
  }

  if (request.forceSwitch) {
    const taken = new Set<number>();
    return forcedSwitchSlots(request)
      .map(({ pool, reviving }) => {
        const free = pool.filter((i) => !taken.has(i));
        if (!free.length) return "pass";
        let pick = free[0];
        if (!reviving) {
          let bestScore = -Infinity;
          for (const i of free) {
            const next = switchIn(ctx, { ...s, us: { ...s.us, active: -1 } }, true, i - 1);
            const score = evaluate(ctx, next) + jitter();
            if (score > bestScore) [pick, bestScore] = [i, score];
          }
        }
        taken.add(pick);
        return `switch ${pick}`;
      })
      .join(", ");
  }

  const options = moveSlotOptions(request, 0, false);
  if (options.length === 1 && options[0].kind === "pass") return "pass";
  const me = side.active[0];
  const foeActive = activeOf(s, false);
  if (!alive(me) || s.us.active < 0 || !foeActive) {
    const fallback = options.find((o) => o.kind === "move" && !o.tera) ?? options[0];
    return fallback.text;
  }

  const replies = replyDistribution(ctx, s, true);
  const scored: { text: string; action: Action; score: number; cost: number }[] = [];
  for (const o of options) {
    let action: Action;
    if (o.kind === "move" && o.move) action = { kind: "move", move: o.move.move, tera: o.tera };
    else if (o.kind === "switch") action = { kind: "switch", to: o.index - 1 };
    else continue;
    let score = expectedValue(ctx, s, action, replies);
    // Terastallizing is once a battle: it has to buy something.
    if (o.tera) score -= 0.01;
    // Switching and Protect cost tempo the model only partly sees.
    if (o.kind === "switch") score -= TUNE.switchCost;
    if (o.kind === "move" && o.move && PROTECT.has(o.move.id)) score -= 0.02;
    // A turn healing is a turn not attacking: the lookahead sees the HP back, not the progress it didn't make.
    if (o.kind === "move" && o.move && moveInfo(ctx.battle, o.move.move).recovery) score -= TUNE.recoverCost;
    // A status move the model has no effect for (Sleep Talk awake, Taunt...) shouldn't beat an attack by nothing.
    if (o.kind === "move" && o.move && isNoop(moveInfo(ctx.battle, o.move.move))) score -= 0.01;
    const cost = score - expectedValue(ctx, s, action, replies);
    scored.push({ text: o.text, action, score: score + jitter(), cost });
  }
  scored.sort((a, b) => b.score - a.score);
  // Hard: the best few are looked at a turn further (our best follow-up against their likeliest reply).
  if (level === "hard" && TUNE.followups > 0) {
    for (const c of scored.slice(0, TUNE.followups)) c.score = expectedValue(ctx, s, c.action, replies, (leaf) => followup(ctx, leaf)) + c.cost;
    scored.sort((a, b) => b.score - a.score);
  }
  let best = scored[0]?.text ?? "";
  if (!best) best = (options.find((o) => o.kind === "move" && !o.tera) ?? options[0]).text;
  const active = request.active?.[0];
  if (best.startsWith("move") && active?.canMegaEvo) best += " mega";
  return best;
}

/** For tests and debugging: every option's expected value on Hard, and the player replies it was weighed against. */
export function explainCpu(battle: Battle, side: Side): { options: { text: string; ev: number }[]; replies: { text: string; w: number }[]; value: number } {
  const request = side.activeRequest as unknown as BattleRequest | null;
  if (!request?.active) throw new Error("Not a move request.");
  const ctx = makeCtx(battle, side, "hard");
  const s = buildState(ctx);
  const replies = replyDistribution(ctx, s, true);
  const options: { text: string; ev: number }[] = [];
  for (const o of moveSlotOptions(request, 0, false)) {
    const action: Action | null = o.kind === "move" && o.move ? { kind: "move", move: o.move.move, tera: o.tera } : o.kind === "switch" ? { kind: "switch", to: o.index - 1 } : null;
    if (action) options.push({ text: `${o.text} (${action.kind === "move" ? action.move : s.us.mons[action.to].p.species.name})`, ev: expectedValue(ctx, s, action, replies) });
  }
  const name = (a: Action) => (a.kind === "move" ? a.move : `switch ${s.them.mons[a.to].p.species.name}`);
  return { options: options.sort((a, b) => b.ev - a.ev), replies: replies.map((r) => ({ text: name(r.action), w: r.w })), value: evaluate(ctx, s) };
}

/** For calibration: what the model expects the two actives to take from each other per turn (fractions of max HP). */
export function debugOffense(battle: Battle, side: Side): { toUs: number; toThem: number; usFirst: boolean } | null {
  const ctx = makeCtx(battle, side, "hard");
  const s = buildState(ctx);
  const us = activeOf(s, true);
  const them = activeOf(s, false);
  if (!us || !them) return null;
  return { toUs: offense(ctx, them, us).frac, toThem: offense(ctx, us, them).frac, usFirst: faster(ctx, us, them) };
}

/** For tests and the benchmark: the model's own view of a position and the value it gives it. */
export function evaluatePosition(battle: Battle, side: Side): number {
  const ctx = makeCtx(battle, side, "hard");
  return evaluate(ctx, buildState(ctx));
}
