import { effectiveness as chart, type PokemonType } from "@/lib/pokemon/type-matrix";
import { CONTACT_REACH, DT, EV, EVENT_INTS, MAX_SECONDS, NOTE, NOTE_CONFUSION, NOTE_INTS, NOTE_ITEM, NOTE_SKIP, RANGED_REACH, ROUND_TICKS, SPREAD_REACH, TICK_HZ } from "./constants";
import { DamageTable, neutralState, type Fighter, type FormRule, type HitEntry, type HitState } from "./damage";
import { placeArmies, placeMelee } from "./formation";
import { expectedHitsOf } from "./moves";
import { expandArmy, factsOf, moveIndex, resolveSet, setKey } from "./sets";
import { bodyMass, bodyRadius, runSpeed } from "./stats";
import { fieldOf, itemsOf, STATUS, type Boosts, type BattleOutcome, type BattleSpec, type FieldSpec, type Formation, type MBMove, type MBSpecies, type Roster, type Spacing, type SpreadUse, type Stance, type StatusId, type Targeting, type UnitSet, type Winner } from "./types";

/**
 * The Mass Battle simulation: thousands of Pokémon on an open field, every
 * hit worked out with the games' damage formula (see damage.ts) and the
 * games' turn rules.
 *
 * Rounds, like turns in the games: every Pokémon acts once a round (three
 * seconds of battle time). Each picks its move as the round starts, the
 * one that does the most expected damage (accuracy × average damage, over
 * every foe a spread move would hit, never more than the HP they have
 * left); priority moves go first, then higher Speed (the battle stat with
 * its stages, paralysis, Choice Scarf and the weather abilities), ties at
 * random, and the actions are spread over the round in that order.
 *
 * As in the games: accuracy and evasion (with their stages, abilities,
 * items and the weather), critical hits, the 16 damage rolls, multi-hit
 * counts, recoil, drain and Life Orb; the side effects of moves (Thunder-
 * bolt's paralysis, Crunch's Defense drop, Iron Head's flinch, Close
 * Combat's own drops) and the stat stages they leave; the major status
 * conditions (paralysis, burn, poison, bad poison, sleep and freezing) and
 * who they can't touch; contact abilities and items (Static, Flame Body,
 * Rough Skin, Rocky Helmet); the abilities that grow with the battle (Moxie,
 * Beast Boost, Speed Boost, Stamina, Justified, Weak Armor…); Truant, Slow
 * Start, the abilities that change form or type (Stance Change, Schooling,
 * Shields Down, Ice Face, Protean, Libero), Mold Breaker; Sturdy, Focus
 * Sash and Disguise hit by hit (multi-hit moves break them), Air Balloon,
 * Sitrus and Lum Berries, Leftovers, Weakness Policy, King's Rock, Knock
 * Off; and the end of each round: sandstorm, Grassy Terrain, Leftovers,
 * poison and burns, Shed Skin, Hydration.
 *
 * Positioning is this page's own addition: Pokémon run at 10 m/s per 100
 * base Speed towards their target (the nearest foe they can hurt, the
 * weakest or strongest near them, or the other side's boss); a move that
 * makes contact needs them next to it, any other move reaches 6 m; spread
 * moves (Earthquake, Surf…) hit every foe within 3 m of the user's body;
 * bodies push each other apart (heavier ones push harder) and a hit knocks
 * its target back by its damage over the target's weight. A side that
 * holds the line waits for the other to come close.
 *
 * Struct-of-arrays in typed arrays, a uniform grid for neighbours and a
 * coarse one for finding foes, no allocation per tick: 10,000 units run
 * well inside real time. Deterministic: the same battle and seed play out
 * the same way, hit for hit.
 */

export { CONTACT_REACH, DT, EV, EVENT_INTS, MAX_SECONDS, NOTE, NOTE_INTS, NOTE_ITEM, NOTE_SKIP, RANGED_REACH, ROUND_TICKS, SPREAD_REACH, TICK_HZ };

/** Actions are spread over the first ticks of a round, fastest first. */
const ACT_TICKS = 50;
/** Coarse cells searched around a unit for its nearest foe; beyond them it heads for the other army's beacons. */
const LOCAL_RINGS = 4;
const BEACONS = 96;
/** Knockback: m/s per point of damage per kg, capped. */
const KNOCK = 1.1;
const KNOCK_MAX = 6;
const KNOCK_DECAY = 5;
/** "Weakest / strongest nearby": foes within this far (m, past the bodies), or the nearest. */
const NEARBY = 9;
/** A side holding the line moves on once nobody has acted for this long (both holding would never meet). */
const HOLD_IDLE_TICKS = 6 * TICK_HZ;
/** A side holding the line steps up to foes this close. */
const HOLD_ENGAGE = 8;

/** How a side fights. */
export interface SideBehaviour {
  spacing: Spacing;
  targeting: Targeting;
  stance: Stance;
  spread: SpreadUse;
}

export const DEFAULT_BEHAVIOUR: SideBehaviour = { spacing: "normal", targeting: "nearest", stance: "charge", spread: "auto" };

/** The battle's fighters (a species and its set) and armies, resolved from the roster. */
export interface Prepared {
  /** Per fighter. */
  species: MBSpecies[];
  sets: UnitSet[];
  moves: MBMove[][];
  /** Everyone's level unless their set says otherwise. */
  level: number;
  /** Units per side, fighter by fighter: [fighter index, count]. */
  armies: [[number, number][], [number, number][]];
  formations: [Formation, Formation];
  behaviour: [SideBehaviour, SideBehaviour];
  field: FieldSpec;
  seed: number;
  /** "field": the armies a charge apart (the page); "melee": everyone in reach from the start, nobody moves (for checks against the simulator). */
  layout: "field" | "melee";
}

/** Turns a battle spec into the fighters and armies the engine uses (groups spelled out, sets resolved). */
export function prepare(roster: Roster, spec: BattleSpec, opts: { layout?: "field" | "melee" } = {}): Prepared {
  const byId = new Map(roster.species.map((s) => [s.id, s]));
  const byName = moveIndex(roster.moves);
  const species: MBSpecies[] = [];
  const sets: UnitSet[] = [];
  const index = new Map<string, number>();
  const armies: [[number, number][], [number, number][]] = [[], []];
  const items = itemsOf(spec);
  const facts = spec.sides.some((a) => a.units.some((u) => u.group)) ? roster.species.map(factsOf) : [];
  spec.sides.forEach((army, s) => {
    for (const u of expandArmy(army, facts)) {
      const sp = byId.get(u.id);
      if (!sp || u.count <= 0) continue;
      const set = resolveSet(sp, roster, u.set, spec.level, items, byName);
      const key = `${sp.id}#${setKey(set)}`;
      let k = index.get(key);
      if (k === undefined) {
        k = species.length;
        species.push(sp);
        sets.push(set);
        index.set(key, k);
      }
      const prev = armies[s].find((e) => e[0] === k);
      if (prev) prev[1] += Math.floor(u.count);
      else armies[s].push([k, Math.floor(u.count)]);
    }
  });
  const behaviour = spec.sides.map((a) => ({ spacing: a.spacing ?? "normal", targeting: a.targeting ?? "nearest", stance: a.stance ?? "charge", spread: a.spread ?? "auto" })) as [SideBehaviour, SideBehaviour];
  return {
    species,
    sets,
    moves: sets.map((s) => s.moves),
    level: spec.level,
    armies,
    formations: [spec.sides[0].formation, spec.sides[1].formation],
    behaviour,
    field: fieldOf(spec),
    seed: spec.seed >>> 0,
    layout: opts.layout ?? "field",
  };
}

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Stat stage slots per unit. */
const ATK = 0, DEF = 1, SPA = 2, SPD = 3, SPE = 4, ACC = 5, EVA = 6, STAGES = 7;
const STAGE_OF: Record<string, number> = { atk: ATK, def: DEF, spa: SPA, spd: SPD, spe: SPE, accuracy: ACC, evasion: EVA };
const statMul = (s: number) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const accMul = (s: number) => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));

const WEATHER_SPEED: Record<string, FieldSpec["weather"]> = { swiftswim: "rain", chlorophyll: "sun", sandrush: "sand", slushrush: "snow" };
const STATUS_CODE: Record<StatusId, number> = { par: STATUS.par, brn: STATUS.brn, psn: STATUS.psn, tox: STATUS.tox, slp: STATUS.slp, frz: STATUS.frz };
const CLEAR_BODY = new Set(["clearbody", "whitesmoke", "fullmetalbody"]);
/**
 * The target's abilities a Mold Breaker (Teravolt, Turboblaze) move ignores, of those this battle checks itself
 * (the calculator handles the damage ones): Showdown's "breakable" abilities.
 */
export const BREAKABLE = new Set([
  "sturdy", "disguise", "iceface", "shielddust", "innerfocus", "owntempo", "limber", "insomnia", "vitalspirit", "waterveil",
  "waterbubble", "thermalexchange", "immunity", "pastelveil", "magmaarmor", "leafguard", "sweetveil", "purifyingsalt",
  "clearbody", "whitesmoke", "hypercutter", "bigpecks", "keeneye", "mindseye", "contrary", "simple", "dazzling",
  "queenlymajesty", "armortail", "sandveil", "snowcloak", "stickyhold",
]);
const MOLD_BREAKERS = new Set(["moldbreaker", "teravolt", "turboblaze"]);
/** Slow Start holds its Pokémon back for its first five turns. */
const SLOW_START_ROUNDS = 5;
/** Bookkeeping bits on a move use's per-target flags (never in an event): hit by the current hit; a Disguise or Ice Face took it. */
const HIT_NOW = 1 << 12;
const SHIELD = 1 << 13;
const SAND_IMMUNE_ABILITIES = new Set(["sandveil", "sandrush", "sandforce", "overcoat", "magicguard"]);
const CHOICE = new Set(["choiceband", "choicespecs", "choicescarf"]);

/** What changes with a fighter's form. */
interface FormRow {
  types: string[];
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  grounded: boolean;
}

/** Per-fighter numbers the engine reads every tick. */
interface FighterRow {
  maxHp: number;
  /** Raw Speed stat (stages and the rest are applied as it acts). */
  spe: number;
  stats: { atk: number; def: number; spa: number; spd: number; spe: number };
  /** Its forms (one unless an ability changes it: see formsOf in damage.ts), and the rule they follow. */
  forms: FormRow[];
  formRule: FormRule;
  radius: number;
  mass: number;
  vmax: number;
  ability: string;
  item: string;
  /** Types it defends with (its Tera type once Terastallized). */
  types: string[];
  /** On the ground: not Flying, no Levitate (an Air Balloon is checked as it fights). */
  grounded: boolean;
  /** How big a threat it is (base stat total, scaled by level), for "strongest" and "boss". */
  threat: number;
  critBoost: number;
  critImmune: boolean;
  sturdy: boolean;
  noRecoil: boolean;
  magicGuard: boolean;
  noGuard: boolean;
  accMul: number;
  physAccMul: number;
  skillLink: boolean;
  loadedDice: boolean;
  lifeOrb: boolean;
  sheerForce: boolean;
  sereneGrace: boolean;
  /** Shield Dust: no side effects of foes' moves (Covert Cloak, an item, is checked as it's held). */
  shieldDust: boolean;
  contactProof: boolean;
  /** Mega forms can't lose their stone. */
  mega: boolean;
  /** Mold Breaker, Teravolt, Turboblaze: its moves ignore the target's breakable abilities. */
  moldBreaker: boolean;
  /** Truant: it loafs around every other turn. */
  truant: boolean;
  /** Slow Start: half Attack and Speed for its first five turns. */
  slowStart: boolean;
  /** Protosynthesis in sun, or Quark Drive on Electric Terrain, with Speed its best stat: 1.5× Speed. */
  boostedSpeed: boolean;
  /** Disguise: the first hit does nothing but costs an eighth of its HP. */
  disguise: boolean;
}

export interface BattleStats {
  /** Most KOs by one unit, and that unit. */
  mvp: number;
  mvpKos: number;
  /** The biggest single hit: damage, attacker, target, move slot, crit. */
  big: { damage: number; actor: number; target: number; slot: number; crit: boolean } | null;
}

export class Battle {
  readonly prep: Prepared;
  readonly table: DamageTable;
  readonly n: number;
  readonly arena: number;
  readonly rows: FighterRow[];
  readonly sp: Uint16Array;
  readonly side: Uint8Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Movement this tick (m/s), for drawing. */
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  private kx: Float64Array;
  private kz: Float64Array;
  /** How far the crowd pushed each unit lately (decaying), so it stops pressing into it. */
  private lx: Float64Array;
  private lz: Float64Array;
  readonly hp: Int32Array;
  readonly alive: Uint8Array;
  readonly target: Int32Array;
  /** Major status (STATUS codes), sleep turns left, bad-poison counter. */
  readonly status: Uint8Array;
  private sleep: Int8Array;
  private toxic: Uint8Array;
  /** Stat stages, STAGES per unit (Attack, Defense, Sp. Atk, Sp. Def, Speed, accuracy, evasion). */
  readonly stages: Int8Array;
  /** Round in which each unit flinched (−1 none). */
  private flinchRound: Int32Array;
  /** Round in which each unit last acted (−1 none). */
  private actedRound: Int32Array;
  /** Its item is gone (used, popped or Knocked Off). */
  readonly itemGone: Uint8Array;
  /** Disguise or Ice Face has taken its hit. */
  private shieldUsed: Uint8Array;
  /** Each unit's form (see formsOf in damage.ts). */
  readonly form: Uint8Array;
  /** Truant: it moved last time, so it loafs around next. */
  private loaf: Uint8Array;
  /** Choice lock (move slot, −1 none). */
  private lock: Int8Array;
  /** Confusion: turns left (0 none). */
  readonly confused: Int8Array;
  /** Outrage and the like: the slot it's locked into and uses left (then it's confused). */
  private rampSlot: Int8Array;
  private rampLeft: Int8Array;
  /** The move planned this round (slot), chosen as the round starts, and the foe it was chosen against. */
  private plan: Int8Array;
  private planTarget: Int32Array;
  private actTick: Int32Array;
  readonly kos: Int32Array;
  readonly dealt: Float64Array;
  /** Tick each unit fainted, −1 while it stands. */
  readonly faintTick: Int32Array;
  tick = 0;
  ended = false;
  /** When both armies fall at once, the side whose Pokémon fainted last wins (as in the games, Gen 5 on). */
  private lastFaintSide = -1;
  winner: Winner = 2;
  readonly left: [number, number] = [0, 0];
  readonly sideKos: [number, number] = [0, 0];
  readonly sideDealt: [number, number] = [0, 0];
  readonly start: [number, number] = [0, 0];
  private bigHit: BattleStats["big"] = null;
  /** This tick's hits (EVENT_INTS each). */
  events: Int32Array = new Int32Array(EVENT_INTS * 256);
  eventCount = 0;
  /** This tick's other happenings: status, healing, chip damage, stat stages, lost turns, items (NOTE_INTS each). */
  notes: Int32Array = new Int32Array(NOTE_INTS * 128);
  noteCount = 0;
  private actionId = 0;
  private rng: number;
  private round = -1;
  private idleSince = 0;
  // Turn order for the current round.
  private order: Int32Array;
  private orderLen = 0;
  private orderAt = 0;
  private keys: Float64Array;
  // Grids.
  private cell: number;
  private cols: number;
  private cellStart: Int32Array;
  private cellItems: Int32Array;
  private cellOf: Int32Array;
  private bigUnits: Int32Array;
  private bigCount = 0;
  private small: Uint8Array;
  private coarse: number;
  private ccols: number;
  private cStart: Int32Array;
  private cItems: Int32Array;
  private cx: Float64Array;
  private cz: Float64Array;
  /** canHurt[a * F + d]: fighter a has a move that can damage fighter d. */
  private canHurt: Uint8Array;
  private aliveByFighter: Int32Array;
  /** 1 while a unit is heading for a far beacon rather than a foe near it. */
  private far: Uint8Array;
  private beacons: [Int32Array, Int32Array] = [new Int32Array(BEACONS), new Int32Array(BEACONS)];
  private beaconCount: [number, number] = [0, 0];
  /** Each side's boss (its biggest threat standing), for "focus the boss". */
  private bossOf: [number, number] = [-1, -1];
  private state: HitState = neutralState(1, 1);
  private scratch: Int32Array = new Int32Array(1024);
  private hitScratch: Int32Array = new Int32Array(1024);
  private doneScratch: Float64Array = new Float64Array(64);
  private effCache = new Map<number, number>();

  constructor(prep: Prepared, table?: DamageTable) {
    this.prep = prep;
    const fighters: Fighter[] = prep.species.map((species, k) => ({ species, set: prep.sets[k] }));
    this.table = table ?? new DamageTable(fighters, prep.field);
    this.rng = (prep.seed ^ 0x9e3779b9) >>> 0;
    const F = prep.species.length;
    const field = prep.field;
    this.rows = prep.species.map((s, k) => {
      const set = prep.sets[k];
      const st = this.table.stats(k);
      const ab = toId(set.ability);
      const it = toId(set.item);
      const forecast = ab === "forecast" && s.calc === "Castform" ? ({ sun: "fire", rain: "water", snow: "ice" } as Record<string, string>)[field.weather] : undefined;
      const types = set.tera ? [set.tera.toLowerCase()] : forecast ? [forecast] : s.types;
      const bst = s.base.hp + s.base.atk + s.base.def + s.base.spa + s.base.spd + s.base.spe;
      const formRule = this.table.rules[k];
      const forms: FormRow[] = this.table.formDefs[k].map((_, f) => {
        const fs = this.table.stats(k, f);
        const ft = f === 0 || set.tera ? types : this.table.types(k, f);
        return { types: ft, stats: { atk: fs.atk, def: fs.def, spa: fs.spa, spd: fs.spd, spe: fs.spe }, grounded: !ft.includes("flying") && ab !== "levitate" };
      });
      // Protosynthesis and Quark Drive: the stat they boost is the best one as the battle starts.
      const paradox = (ab === "protosynthesis" && field.weather === "sun") || (ab === "quarkdrive" && field.terrain === "electric");
      const best = (["atk", "def", "spa", "spd", "spe"] as const).reduce((a, b) => (st[b] > st[a] ? b : a), "atk" as "atk" | "def" | "spa" | "spd" | "spe");
      return {
        maxHp: this.table.maxHp(k),
        spe: st.spe,
        stats: { atk: st.atk, def: st.def, spa: st.spa, spd: st.spd, spe: st.spe },
        forms,
        formRule,
        radius: bodyRadius(s),
        mass: bodyMass(s.kg),
        vmax: runSpeed(s.base.spe),
        ability: ab,
        item: it,
        types,
        grounded: !types.includes("flying") && ab !== "levitate",
        threat: bst * (0.5 + set.level / 200),
        critBoost: (ab === "superluck" ? 1 : 0) + (it === "scopelens" || it === "razorclaw" ? 1 : 0),
        critImmune: ab === "battlearmor" || ab === "shellarmor",
        sturdy: ab === "sturdy",
        noRecoil: ab === "rockhead" || ab === "magicguard",
        magicGuard: ab === "magicguard",
        noGuard: ab === "noguard",
        accMul: (ab === "compoundeyes" ? 1.3 : 1) * (ab === "victorystar" ? 1.1 : 1) * (it === "widelens" ? 1.1 : 1),
        physAccMul: ab === "hustle" ? 0.8 : 1,
        skillLink: ab === "skilllink",
        loadedDice: it === "loadeddice",
        lifeOrb: it === "lifeorb",
        sheerForce: ab === "sheerforce",
        sereneGrace: ab === "serenegrace",
        shieldDust: ab === "shielddust",
        contactProof: ab === "longreach" || it === "protectivepads",
        mega: s.form === "mega",
        moldBreaker: MOLD_BREAKERS.has(ab),
        truant: ab === "truant",
        slowStart: ab === "slowstart",
        boostedSpeed: paradox && best === "spe",
        disguise: ab === "disguise",
      };
    });
    // Units, army by army, fighter by fighter.
    let n = 0;
    for (const army of prep.armies) for (const [, c] of army) n += c;
    this.n = n;
    this.sp = new Uint16Array(n);
    this.side = new Uint8Array(n);
    let k = 0;
    prep.armies.forEach((army, s) => {
      for (const [fi, c] of army) for (let j = 0; j < c; j++) { this.sp[k] = fi; this.side[k] = s; k++; }
    });
    const radius = new Float64Array(n);
    for (let i = 0; i < n; i++) radius[i] = this.rows[this.sp[i]].radius;
    const place = prep.layout === "melee"
      ? placeMelee(radius, this.side)
      : placeArmies(radius, this.side, prep.formations, () => this.random(), [prep.behaviour[0].spacing, prep.behaviour[1].spacing]);
    this.x = place.x;
    this.z = place.z;
    this.arena = place.arena;
    this.vx = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.kx = new Float64Array(n);
    this.kz = new Float64Array(n);
    this.lx = new Float64Array(n);
    this.lz = new Float64Array(n);
    this.hp = new Int32Array(n);
    this.alive = new Uint8Array(n);
    this.target = new Int32Array(n).fill(-1);
    this.status = new Uint8Array(n);
    this.sleep = new Int8Array(n);
    this.toxic = new Uint8Array(n);
    this.stages = new Int8Array(n * STAGES);
    this.flinchRound = new Int32Array(n).fill(-1);
    this.actedRound = new Int32Array(n).fill(-1);
    this.itemGone = new Uint8Array(n);
    this.shieldUsed = new Uint8Array(n);
    this.form = new Uint8Array(n);
    this.loaf = new Uint8Array(n);
    this.lock = new Int8Array(n).fill(-1);
    this.confused = new Int8Array(n);
    this.rampSlot = new Int8Array(n).fill(-1);
    this.rampLeft = new Int8Array(n);
    this.plan = new Int8Array(n).fill(-1);
    this.planTarget = new Int32Array(n).fill(-1);
    this.actTick = new Int32Array(n).fill(-1);
    this.kos = new Int32Array(n);
    this.dealt = new Float64Array(n);
    this.faintTick = new Int32Array(n).fill(-1);
    this.order = new Int32Array(n);
    this.keys = new Float64Array(n);
    this.aliveByFighter = new Int32Array(F);
    for (let i = 0; i < n; i++) {
      const row = this.rows[this.sp[i]];
      this.hp[i] = row.maxHp;
      this.alive[i] = 1;
      this.left[this.side[i]]++;
      this.aliveByFighter[this.sp[i]]++;
      if (!row.item) this.itemGone[i] = 1;
      // Schooling: a Wishiwashi from level 20 starts in School Form.
      if (row.formRule === "school" && prep.sets[this.sp[i]].level >= 20) this.form[i] = 1;
      // Abilities that act as the battle starts, on the Pokémon itself (Gen 9: once a battle).
      if (row.ability === "intrepidsword") this.stages[i * STAGES + ATK] = 1;
      else if (row.ability === "dauntlessshield") this.stages[i * STAGES + DEF] = 1;
    }
    this.start[0] = this.left[0];
    this.start[1] = this.left[1];
    const RESIDUAL_ABILITIES = new Set(["speedboost", "raindish", "dryskin", "icebody", "solarpower", "poisonheal", "shedskin", "hydration"]);
    this.residualFighters = this.rows.some((r) => r.item === "leftovers" || r.item === "blacksludge" || RESIDUAL_ABILITIES.has(r.ability) || r.formRule === "school" || r.formRule === "shields");
    // Damage between the sides, worked out before the first round.
    const sideFighters = (s: number) => [...new Set(prep.armies[s].map(([fi]) => fi))];
    this.table.warm(sideFighters(0), sideFighters(1));
    this.canHurt = new Uint8Array(F * F);
    for (const a of sideFighters(0)) for (const d of sideFighters(1)) this.canHurt[a * F + d] = this.table.canDamage(a, d) ? 1 : 0;
    for (const a of sideFighters(1)) for (const d of sideFighters(0)) this.canHurt[a * F + d] = this.table.canDamage(a, d) ? 1 : 0;
    // Grids: fine cells sized for most bodies (bigger ones are checked on their own), coarse cells for finding foes.
    const radii = Array.from(radius).sort((a, b) => a - b);
    const rSmall = radii.length ? radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.85))] : 0.5;
    this.cell = Math.max(0.5, 2 * rSmall);
    this.cols = Math.max(1, Math.ceil((2 * this.arena) / this.cell));
    this.cellStart = new Int32Array(this.cols * this.cols + 1);
    this.cellItems = new Int32Array(n);
    this.cellOf = new Int32Array(n);
    this.small = new Uint8Array(n);
    let big = 0;
    for (let i = 0; i < n; i++) {
      if (radius[i] * 2 <= this.cell + 1e-9) this.small[i] = 1;
      else big++;
    }
    this.bigUnits = new Int32Array(big);
    // Coarse cells hold a couple of dozen units of a packed army, so a search for a foe reads few of them.
    const rMid = radii.length ? radii[Math.floor(radii.length / 2)] : 0.5;
    this.coarse = Math.max(1, Math.max(this.cell, 2 * rMid * 1.35) * 4.5);
    this.ccols = Math.max(1, Math.ceil((2 * this.arena) / this.coarse));
    // One coarse grid per side (side B's cells after side A's), so a search reads only foes.
    this.cStart = new Int32Array(2 * this.ccols * this.ccols + 1);
    this.cItems = new Int32Array(n);
    this.cx = new Float64Array(n);
    this.cz = new Float64Array(n);
    this.far = new Uint8Array(n);
    this.rebuildGrids();
    this.refreshBeacons();
    this.refreshBosses();
    for (let i = 0; i < n; i++) this.target[i] = this.findTarget(i);
  }

  /** Seeded uniform [0, 1) (mulberry32). */
  random(): number {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0;
    let t = this.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  get seconds() {
    return this.tick / TICK_HZ;
  }

  // -------------------------------------------------------------------------
  // Grids
  // -------------------------------------------------------------------------

  private cellIndex(x: number, z: number, size: number, cols: number): number {
    const a = this.arena;
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((x + a) / size)));
    const cz = Math.min(cols - 1, Math.max(0, Math.floor((z + a) / size)));
    return cz * cols + cx;
  }

  private rebuildGrids() {
    const { n, alive, x, z } = this;
    const fine = this.cellStart, coarse = this.cStart;
    fine.fill(0);
    coarse.fill(0);
    this.bigCount = 0;
    const cOf = this.cellOf;
    const cells = this.ccols * this.ccols;
    // Counting sort into cells (fine for small bodies, coarse per side for everyone).
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (this.small[i]) {
        const c = this.cellIndex(x[i], z[i], this.cell, this.cols);
        cOf[i] = c;
        fine[c + 1]++;
      } else {
        this.bigUnits[this.bigCount++] = i;
      }
      coarse[this.side[i] * cells + this.cellIndex(x[i], z[i], this.coarse, this.ccols) + 1]++;
    }
    for (let c = 1; c < fine.length; c++) fine[c] += fine[c - 1];
    for (let c = 1; c < coarse.length; c++) coarse[c] += coarse[c - 1];
    const fillF = this.scratchFill(fine.length);
    if (!this.fillC || this.fillC.length < coarse.length) this.fillC = new Int32Array(coarse.length);
    const fillC = this.fillC;
    fillC.fill(0);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (this.small[i]) {
        const c = cOf[i];
        this.cellItems[fine[c] + fillF[c]++] = i;
      }
      const cc = this.side[i] * cells + this.cellIndex(x[i], z[i], this.coarse, this.ccols);
      this.cItems[coarse[cc] + fillC[cc]++] = i;
    }
  }

  private fillBuf: Int32Array | null = null;
  private fillC: Int32Array | null = null;
  private scratchFill(len: number): Int32Array {
    if (!this.fillBuf || this.fillBuf.length < len) this.fillBuf = new Int32Array(len);
    else this.fillBuf.fill(0, 0, len);
    return this.fillBuf;
  }

  /** `i`'s target by its side's rule: the nearest foe it can hurt (or the nearest at all), the weakest or strongest near it, or the boss. −1 if none is left. */
  findTarget(i: number): number {
    const F = this.prep.species.length;
    const mySide = this.side[i], row = this.sp[i] * F;
    const rule = this.prep.behaviour[mySide].targeting;
    const { alive, sp, x, z, canHurt, hp } = this;
    if (rule === "boss") {
      const b = this.bossOf[1 - mySide];
      if (b >= 0 && alive[b] && canHurt[row + sp[b]]) {
        this.far[i] = 0;
        return b;
      }
    }
    const xi = x[i], zi = z[i];
    const cols = this.ccols, size = this.coarse, a = this.arena;
    const px = xi + a, pz = zi + a;
    const ccx = Math.min(cols - 1, Math.max(0, Math.floor(px / size)));
    const ccz = Math.min(cols - 1, Math.max(0, Math.floor(pz / size)));
    let best = -1, bestD = Infinity, fallback = -1, fallbackD = Infinity;
    // Weakest / strongest: the best by HP or threat among foes within NEARBY of its body.
    const picky = rule === "weakest" || rule === "strongest";
    const near = this.rows[sp[i]].radius + NEARBY;
    let pick = -1, pickV = 0;
    const { cStart, cItems } = this;
    const base = (1 - mySide) * cols * cols;
    const scan = (gx: number, gz: number) => {
      // Skip a cell that can't hold anything nearer than what's been found.
      const bx = px < gx * size ? gx * size - px : px > (gx + 1) * size ? px - (gx + 1) * size : 0;
      const bz = pz < gz * size ? gz * size - pz : pz > (gz + 1) * size ? pz - (gz + 1) * size : 0;
      const lb = bx * bx + bz * bz;
      if (lb >= bestD && lb >= fallbackD && (!picky || lb > (near + 16) * (near + 16))) return;
      const c = base + gz * cols + gx;
      for (let k = cStart[c], e = cStart[c + 1]; k < e; k++) {
        const j = cItems[k];
        if (!alive[j]) continue;
        const dx = x[j] - xi, dz = z[j] - zi;
        const d = dx * dx + dz * dz;
        if (canHurt[row + sp[j]]) {
          if (d < bestD) { bestD = d; best = j; }
          if (picky) {
            const lim = near + this.rows[sp[j]].radius;
            if (d <= lim * lim) {
              const v = rule === "weakest" ? -hp[j] : this.rows[sp[j]].threat * 1e6 + hp[j];
              if (pick < 0 || v > pickV) { pick = j; pickV = v; }
            }
          }
        } else if (d < fallbackD) { fallbackD = d; fallback = j; }
      }
    };
    for (let ring = 0; ring <= LOCAL_RINGS; ring++) {
      // Every cell of this ring is at least (ring − 1) cells away: stop once that is past the best found.
      const nearRing = Math.max(0, ring - 1) * size;
      if (best >= 0 && nearRing * nearRing >= bestD && (!picky || nearRing > near + 16)) break;
      const z0 = ccz - ring, z1 = ccz + ring, x0 = ccx - ring, x1 = ccx + ring;
      if (z0 < 0 && z1 >= cols && x0 < 0 && x1 >= cols) break;
      for (let gx = Math.max(0, x0); gx <= Math.min(cols - 1, x1); gx++) {
        if (z0 >= 0) scan(gx, z0);
        if (ring > 0 && z1 < cols) scan(gx, z1);
      }
      for (let gz = Math.max(0, z0 + 1); gz <= Math.min(cols - 1, z1 - 1); gz++) {
        if (x0 >= 0) scan(x0, gz);
        if (ring > 0 && x1 < cols) scan(x1, gz);
      }
    }
    if (pick >= 0) {
      this.far[i] = 0;
      return pick;
    }
    if (best >= 0) {
      this.far[i] = 0;
      return best;
    }
    // Nobody close: head for the nearest of the other army's beacons (a spread-out sample of it).
    const other = 1 - mySide;
    const beacons = this.beacons[other];
    let bb = -1, bbD = Infinity, fb = fallback, fbD = fallbackD;
    for (let k = 0; k < this.beaconCount[other]; k++) {
      const j = beacons[k];
      if (!alive[j]) continue;
      const dx = x[j] - xi, dz = z[j] - zi;
      const d = dx * dx + dz * dz;
      if (canHurt[row + sp[j]]) {
        if (d < bbD) { bbD = d; bb = j; }
      } else if (d < fbD) { fbD = d; fb = j; }
    }
    this.far[i] = 1;
    return bb >= 0 ? bb : fb;
  }

  /** A spread-out sample of each army that units far from any foe head for. */
  private refreshBeacons() {
    for (let s = 0; s < 2; s++) {
      const alive = this.left[s];
      const stride = Math.max(1, Math.floor(alive / BEACONS));
      let k = 0, seen = 0;
      for (let i = 0; i < this.n && k < BEACONS; i++) {
        if (!this.alive[i] || this.side[i] !== s) continue;
        if (seen++ % stride === 0) this.beacons[s][k++] = i;
      }
      this.beaconCount[s] = k;
    }
  }

  /** Each side's biggest threat still standing. */
  private refreshBosses() {
    const best = [-1, -1], bestV = [-1, -1];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const s = this.side[i];
      const v = this.rows[this.sp[i]].threat * 1e6 + this.hp[i];
      if (v > bestV[s]) { bestV[s] = v; best[s] = i; }
    }
    this.bossOf = [best[0], best[1]];
  }

  /** Foes of `i`'s side whose bodies are within `reach` of (x, z) (written to the scratch buffer); returns how many. */
  private foesNear(i: number, x: number, z: number, reach: number): number {
    if (this.prep.layout === "melee") {
      // Everyone is in reach of everyone.
      let count = 0;
      for (let j = 0; j < this.n; j++) if (this.alive[j] && this.side[j] !== this.side[i]) this.scratch[count++] = j;
      return count;
    }
    const cols = this.ccols, size = this.coarse, a = this.arena;
    const base = (1 - this.side[i]) * cols * cols;
    const span = Math.ceil((reach + 16) / size);
    const ccx = Math.floor((x + a) / size), ccz = Math.floor((z + a) / size);
    let count = 0;
    for (let gz = Math.max(0, ccz - span); gz <= Math.min(cols - 1, ccz + span); gz++) {
      for (let gx = Math.max(0, ccx - span); gx <= Math.min(cols - 1, ccx + span); gx++) {
        const c = base + gz * cols + gx;
        for (let k = this.cStart[c]; k < this.cStart[c + 1]; k++) {
          const j = this.cItems[k];
          if (!this.alive[j]) continue;
          const dx = this.x[j] - x, dz = this.z[j] - z;
          const lim = reach + this.rows[this.sp[j]].radius;
          if (dx * dx + dz * dz <= lim * lim) {
            if (count >= this.scratch.length) {
              const grown = new Int32Array(this.scratch.length * 2);
              grown.set(this.scratch);
              this.scratch = grown;
            }
            this.scratch[count++] = j;
          }
        }
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // The state a hit reads
  // -------------------------------------------------------------------------

  private gap(i: number, j: number): number {
    if (this.prep.layout === "melee") return 0;
    const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
    return Math.sqrt(dx * dx + dz * dz) - this.rows[this.sp[i]].radius - this.rows[this.sp[j]].radius;
  }

  private stage(i: number, k: number): number {
    return this.stages[i * STAGES + k];
  }

  private hasItem(i: number, id: string): boolean {
    return !this.itemGone[i] && this.rows[this.sp[i]].item === id;
  }

  /** What `i`'s current form changes: its types, stats, whether it's on the ground. */
  private formRow(i: number): FormRow {
    const row = this.rows[this.sp[i]];
    return row.forms[this.form[i]] ?? row.forms[0];
  }

  private typesOf(i: number): string[] {
    return this.formRow(i).types;
  }

  /** Grounded right now (an Air Balloon keeps it up until it pops). */
  private grounded(i: number): boolean {
    return this.formRow(i).grounded && !this.hasItem(i, "airballoon");
  }

  /** `j`'s ability as `i`'s move sees it: "" when Mold Breaker ignores it. */
  private abilityVs(i: number, j: number): string {
    const ab = this.rows[this.sp[j]].ability;
    return i >= 0 && this.rows[this.sp[i]].moldBreaker && BREAKABLE.has(ab) ? "" : ab;
  }

  /** Slow Start still holds it back (its first five turns). */
  private slowed(i: number): boolean {
    return this.rows[this.sp[i]].slowStart && this.round < SLOW_START_ROUNDS;
  }

  private hitState(i: number, j: number, mv: MBMove, crit: boolean, spread: boolean): HitState {
    const st = this.state;
    st.crit = crit;
    st.spread = spread;
    st.aHp = this.hp[i];
    st.aMax = this.rows[this.sp[i]].maxHp;
    st.dHp = this.hp[j];
    st.dMax = this.rows[this.sp[j]].maxHp;
    const S = this.stages, ai = i * STAGES, dj = j * STAGES;
    setStages(st, mv, S[ai + ATK], S[ai + DEF], S[ai + SPA], S[dj + ATK], S[dj + DEF], S[dj + SPD]);
    st.aStatus = this.status[i];
    st.dStatus = this.status[j];
    st.aItem = !this.itemGone[i];
    st.dItem = !this.itemGone[j];
    st.aForm = this.form[i];
    st.dForm = this.form[j];
    st.aSlow = this.slowed(i);
    return st;
  }

  /** Chance the move lands on `j`. */
  private accuracy(i: number, j: number, mv: MBMove): number {
    const a = this.rows[this.sp[i]], d = this.rows[this.sp[j]];
    return hitChance({
      mv,
      aAbility: a.ability,
      aItem: this.itemGone[i] ? "" : a.item,
      dAbility: this.abilityVs(i, j),
      dItem: this.itemGone[j] ? "" : d.item,
      accStage: this.stage(i, ACC),
      evaStage: this.stage(j, EVA),
      weather: this.prep.field.weather,
      targetMoved: this.actedRound[j] === this.round,
    });
  }

  /** Moves that can't touch this target now: priority into Psychic Terrain or Dazzling, Sucker Punch on a foe that already moved (or isn't attacking). */
  private blocked(i: number, j: number, mv: MBMove, slotPriority: number): boolean {
    if (slotPriority > 0) {
      if (this.prep.field.terrain === "psychic" && this.grounded(j)) return true;
      const ab = this.abilityVs(i, j);
      if (ab === "dazzling" || ab === "queenlymajesty" || ab === "armortail") return true;
    }
    const id = toId(mv.name);
    if ((id === "suckerpunch" || id === "thunderclap") && (this.actedRound[j] === this.round || this.plan[j] < 0)) return true;
    return false;
  }

  /** Expected damage of one use against one foe (capped at its HP). */
  private expected(i: number, slot: number, j: number, spread: boolean): number {
    const mv = this.prep.moves[this.sp[i]][slot];
    if (this.blocked(i, j, mv, this.priority(i, slot))) return 0;
    const row = this.rows[this.sp[i]];
    const st = this.hitState(i, j, mv, false, spread);
    return expectedDamage(this.table, this.sp[i], slot, this.sp[j], st, this.accuracy(i, j, mv), expectedHits(mv, row.ability, this.itemGone[i] ? "" : row.item), this.hp[j]);
  }

  /** The move `i` wants this round against `j`: the most expected damage over everyone it would hit (ignoring reach). */
  private planMove(i: number, j: number): number {
    const moves = this.prep.moves[this.sp[i]];
    if (this.rampLeft[i] > 0 && this.rampSlot[i] >= 0) return this.rampSlot[i];
    const locked = this.itemGone[i] ? -1 : this.lock[i];
    if (locked >= 0 && locked < moves.length) return locked;
    const never = this.prep.behaviour[this.side[i]].spread === "never";
    let best = -1, bestV = 0, bestSpread = -1, bestSpreadV = 0;
    for (let s = 0; s < moves.length; s++) {
      const mv = moves[s];
      let v: number;
      if (mv.spread && this.gap(i, j) <= RANGED_REACH) {
        const count = this.foesNear(i, this.x[i], this.z[i], this.rows[this.sp[i]].radius + SPREAD_REACH);
        if (count >= 2) {
          v = 0;
          for (let k = 0; k < count; k++) v += this.expected(i, s, this.scratch[k], true);
        } else v = this.expected(i, s, j, false);
      } else v = this.expected(i, s, j, false);
      if (never && mv.spread) {
        if (v > bestSpreadV) { bestSpreadV = v; bestSpread = s; }
        continue;
      }
      if (v > bestV) { bestV = v; best = s; }
    }
    // "Never" still uses a spread move when it has nothing else that works.
    return best >= 0 ? best : bestSpread;
  }

  private priority(i: number, slot: number): number {
    if (slot < 0) return 0;
    const mv = this.prep.moves[this.sp[i]][slot];
    const row = this.rows[this.sp[i]];
    let p = mv.pri;
    if (row.ability === "galewings" && mv.type === "Flying" && this.hp[i] >= row.maxHp) p += 1;
    if (row.ability === "triage" && mv.drain) p += 3;
    return p;
  }

  /** The Speed it acts on: its stat (in its form) with stages, paralysis, Choice Scarf, the weather abilities, Quick Feet, Unburden, Slow Start, Protosynthesis and Quark Drive. */
  effectiveSpeed(i: number): number {
    const row = this.rows[this.sp[i]];
    let s = this.formRow(i).stats.spe * statMul(this.stage(i, SPE));
    const ab = row.ability;
    const f = this.prep.field;
    if (WEATHER_SPEED[ab] && WEATHER_SPEED[ab] === f.weather) s *= 2;
    if (ab === "surgesurfer" && f.terrain === "electric") s *= 2;
    if (ab === "quickfeet" && this.status[i]) s *= 1.5;
    else if (this.status[i] === STATUS.par) s *= 0.5;
    if (ab === "unburden" && this.itemGone[i] && row.item) s *= 2;
    if (row.boostedSpeed) s *= 1.5;
    if (this.slowed(i)) s *= 0.5;
    if (this.hasItem(i, "choicescarf")) s *= 1.5;
    return Math.floor(s);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private pushEvent(actor: number, target: number, slot: number, damage: number, flags: number) {
    if ((this.eventCount + 1) * EVENT_INTS > this.events.length) {
      const grown = new Int32Array(this.events.length * 2);
      grown.set(this.events);
      this.events = grown;
    }
    const o = this.eventCount * EVENT_INTS;
    this.events[o] = actor;
    this.events[o + 1] = target;
    this.events[o + 2] = slot;
    this.events[o + 3] = damage;
    this.events[o + 4] = flags;
    this.events[o + 5] = this.actionId;
    this.eventCount++;
  }

  private pushNote(unit: number, kind: number, value: number, source = -1) {
    if ((this.noteCount + 1) * NOTE_INTS > this.notes.length) {
      const grown = new Int32Array(this.notes.length * 2);
      grown.set(this.notes);
      this.notes = grown;
    }
    const o = this.noteCount * NOTE_INTS;
    this.notes[o] = unit;
    this.notes[o + 1] = kind;
    this.notes[o + 2] = value;
    this.notes[o + 3] = source;
    this.noteCount++;
  }

  // -------------------------------------------------------------------------
  // Rounds
  // -------------------------------------------------------------------------

  private startRound() {
    const { n, alive } = this;
    this.round++;
    this.refreshBeacons();
    this.refreshBosses();
    let len = 0;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      let t = this.target[i];
      if (t < 0 || !alive[t] || this.prep.behaviour[this.side[i]].targeting !== "nearest") t = this.target[i] = this.findTarget(i);
      const slot = t >= 0 ? this.planMove(i, t) : -1;
      this.plan[i] = slot;
      this.planTarget[i] = t;
      // Priority (Quick Claw now and then), then the Speed it acts on, then a coin toss.
      let pri = this.priority(i, slot);
      if (this.hasItem(i, "quickclaw") && this.random() < 0.2) pri += 0.5;
      else if (this.rows[this.sp[i]].ability === "quickdraw" && this.random() < 0.3) pri += 0.5;
      this.keys[i] = pri * 100000 + this.effectiveSpeed(i) + this.random() * 0.999;
      this.order[len++] = i;
    }
    const keys = this.keys;
    const view = this.order.subarray(0, len);
    view.sort((a, b) => keys[b] - keys[a]);
    for (let r = 0; r < len; r++) this.actTick[view[r]] = this.tick + Math.floor((r * ACT_TICKS) / Math.max(1, len));
    this.orderLen = len;
    this.orderAt = 0;
  }

  private faint(j: number) {
    this.alive[j] = 0;
    this.hp[j] = 0;
    this.faintTick[j] = this.tick;
    this.left[this.side[j]]--;
    this.aliveByFighter[this.sp[j]]--;
    this.lastFaintSide = this.side[j];
  }

  /** HP lost outside a hit (recoil, chip, residual damage): faints it at 0. Credit goes to `by` if a foe did it. */
  private chip(j: number, amount: number, by: number, flags: number = EV.RECOIL) {
    if (!this.alive[j] || amount <= 0) return;
    const done = Math.min(amount, this.hp[j]);
    this.hp[j] -= done;
    this.pushNote(j, NOTE.CHIP, done, by);
    if (this.hp[j] <= 0) {
      this.faint(j);
      this.pushEvent(j, j, -1, done, EV.KO | flags);
      if (by >= 0 && this.side[by] !== this.side[j]) {
        this.kos[by]++;
        this.sideKos[this.side[by]]++;
      }
    } else this.checkBerry(j);
  }

  private heal(j: number, amount: number) {
    if (!this.alive[j] || amount <= 0) return;
    const max = this.rows[this.sp[j]].maxHp;
    const done = Math.min(amount, max - this.hp[j]);
    if (done <= 0) return;
    this.hp[j] += done;
    this.pushNote(j, NOTE.HEAL, done);
  }

  /** Sitrus Berry at half HP or less. */
  private checkBerry(j: number) {
    if (!this.alive[j] || !this.hasItem(j, "sitrusberry")) return;
    const max = this.rows[this.sp[j]].maxHp;
    if (this.hp[j] * 2 > max) return;
    this.itemGone[j] = 1;
    this.pushNote(j, NOTE.ITEM, NOTE_ITEM.sitrus);
    this.heal(j, Math.floor(max / 4));
  }

  /**
   * Whether `j` can be given this status now. `breaker`: it comes from the move of a Mold Breaker (`by`), which ignores
   * the target's breakable abilities.
   */
  private canStatus(j: number, st: StatusId, by: number, breaker = false): boolean {
    if (!this.alive[j] || this.status[j]) return false;
    const row = this.rows[this.sp[j]];
    const t = this.typesOf(j), f = this.prep.field;
    const ab = breaker ? this.abilityVs(by, j) : row.ability;
    if (row.ability === "comatose" || ab === "purifyingsalt") return false;
    // Shields Down: Minior's Meteor Form can't be given a status.
    if (row.formRule === "shields" && this.form[j] === 0) return false;
    if (ab === "leafguard" && f.weather === "sun") return false;
    if (this.grounded(j) && f.terrain === "misty") return false;
    switch (st) {
      case "par": return !t.includes("electric") && ab !== "limber";
      case "brn": return !t.includes("fire") && ab !== "waterveil" && ab !== "waterbubble" && ab !== "thermalexchange";
      case "psn":
      case "tox": {
        const corrosion = by >= 0 && this.rows[this.sp[by]].ability === "corrosion";
        return (corrosion || (!t.includes("poison") && !t.includes("steel"))) && ab !== "immunity" && ab !== "pastelveil";
      }
      case "slp": return ab !== "insomnia" && ab !== "vitalspirit" && ab !== "sweetveil" && !(this.grounded(j) && f.terrain === "electric");
      case "frz": return !t.includes("ice") && ab !== "magmaarmor" && f.weather !== "sun";
    }
  }

  /** Gives `j` a status, if it can take it. `fromMove`: by `by`'s move (Mold Breaker applies; Poison Puppeteer answers). */
  private setStatus(j: number, st: StatusId, by: number, fromMove = false) {
    if (!this.canStatus(j, st, by, fromMove)) return;
    this.status[j] = STATUS_CODE[st];
    if (st === "psn" || st === "tox" || st === "brn") this.residualAny = true;
    if (st === "slp") this.sleep[j] = 2 + Math.floor(this.random() * 3);
    if (st === "tox") this.toxic[j] = 0;
    this.pushNote(j, NOTE.STATUS, STATUS_CODE[st], by);
    if (this.hasItem(j, "lumberry")) {
      this.itemGone[j] = 1;
      this.status[j] = 0;
      this.pushNote(j, NOTE.ITEM, NOTE_ITEM.lum);
      this.pushNote(j, NOTE.CURE, STATUS_CODE[st]);
      return;
    }
    // Poison Puppeteer: Pecharunt's moves that poison also confuse.
    if (fromMove && by >= 0 && by !== j && (st === "psn" || st === "tox") && this.rows[this.sp[by]].ability === "poisonpuppeteer") this.confuse(j, by);
  }

  /** Stat stage changes on `u` (by a foe's move or its own), with the abilities that block, flip or answer them; `by`: the foe whose move it is (its Mold Breaker ignores the blockers). */
  private boost(u: number, boosts: Boosts, byFoe: boolean, by = -1) {
    if (!this.alive[u]) return;
    const row = this.rows[this.sp[u]];
    const ab = byFoe && by >= 0 ? this.abilityVs(by, u) : row.ability;
    let dropped = false;
    for (const key in boosts) {
      let d = boosts[key as keyof Boosts] ?? 0;
      const k = STAGE_OF[key];
      if (d === 0 || k === undefined) continue;
      if (ab === "contrary") d = -d;
      if (ab === "simple") d *= 2;
      if (byFoe && d < 0) {
        if (CLEAR_BODY.has(ab) || this.hasItem(u, "clearamulet")) continue;
        if ((ab === "hypercutter" && k === ATK) || (ab === "bigpecks" && k === DEF) || ((ab === "keeneye" || ab === "mindseye") && k === ACC)) continue;
      }
      const o = u * STAGES + k;
      const before = this.stages[o];
      const after = Math.max(-6, Math.min(6, before + d));
      if (after === before) continue;
      this.stages[o] = after;
      this.pushNote(u, NOTE.BOOST, k * 16 + (after - before + 8));
      if (after < before && byFoe) dropped = true;
    }
    if (dropped) {
      if (row.ability === "defiant") this.boost(u, { atk: 2 }, false);
      else if (row.ability === "competitive") this.boost(u, { spa: 2 }, false);
    }
  }

  /** Whether `i` loses its turn (asleep, frozen, flinched, fully paralysed). */
  private skipsTurn(i: number, mv: MBMove | null): boolean {
    const st = this.status[i];
    if (st === STATUS.slp) {
      this.sleep[i] -= this.rows[this.sp[i]].ability === "earlybird" ? 2 : 1;
      if (this.sleep[i] <= 0) {
        this.status[i] = 0;
        this.pushNote(i, NOTE.CURE, STATUS.slp);
      } else {
        this.pushNote(i, NOTE.SKIP, NOTE_SKIP.sleep);
        return true;
      }
    } else if (st === STATUS.frz) {
      if (mv?.thaws || this.random() < 0.2) {
        this.status[i] = 0;
        this.pushNote(i, NOTE.CURE, STATUS.frz);
      } else {
        this.pushNote(i, NOTE.SKIP, NOTE_SKIP.frozen);
        return true;
      }
    }
    // Truant: every other turn it loafs around (checked after sleep and freezing, before flinching, as in the games).
    if (this.rows[this.sp[i]].truant) {
      if (this.loaf[i]) {
        this.loaf[i] = 0;
        this.pushNote(i, NOTE.SKIP, NOTE_SKIP.loafing);
        return this.interrupted(i);
      }
      this.loaf[i] = 1;
    }
    if (this.flinchRound[i] === this.round) {
      this.pushNote(i, NOTE.SKIP, NOTE_SKIP.flinch);
      if (this.rows[this.sp[i]].ability === "steadfast") this.boost(i, { spe: 1 }, false);
      return this.interrupted(i);
    }
    if (this.confused[i] > 0) {
      this.confused[i]--;
      if (this.confused[i] <= 0) this.pushNote(i, NOTE.CURE, NOTE_CONFUSION);
      else if (this.random() < 0.33) {
        // It hurts itself: a 40-power typeless physical hit on its own Defense, as the games work it out.
        this.pushNote(i, NOTE.SKIP, NOTE_SKIP.confused);
        this.chip(i, this.confusionDamage(i), -1);
        return this.interrupted(i);
      }
    }
    if (this.status[i] === STATUS.par && this.random() < 0.25) {
      this.pushNote(i, NOTE.SKIP, NOTE_SKIP.paralysed);
      return this.interrupted(i);
    }
    return false;
  }

  /** A lost turn ends an Outrage-style lock (without the confusion). */
  private interrupted(i: number): true {
    this.rampLeft[i] = 0;
    this.rampSlot[i] = -1;
    return true;
  }

  /** The damage of hitting itself in confusion (Showdown's getConfusionDamage: its Attack on its Defense, in its form; a burn doesn't change it). */
  private confusionDamage(i: number): number {
    const st = this.formRow(i).stats;
    const level = this.prep.sets[this.sp[i]].level;
    const atk = Math.floor(st.atk * statMul(this.stage(i, ATK)));
    const def = Math.floor(st.def * statMul(this.stage(i, DEF)));
    const base = Math.floor(Math.floor(Math.floor((2 * level) / 5 + 2) * 40 * atk / Math.max(1, def)) / 50) + 2;
    const dmg = Math.floor((base * (100 - Math.floor(this.random() * 16))) / 100);
    return Math.max(1, dmg);
  }

  /** Confuses `j` (2 to 5 turns) unless something stops it (`by`: the foe whose move it is, for Mold Breaker). */
  private confuse(j: number, by = -1) {
    if (!this.alive[j] || this.confused[j] > 0) return;
    if ((by >= 0 ? this.abilityVs(by, j) : this.rows[this.sp[j]].ability) === "owntempo") return;
    if (this.prep.field.terrain === "misty" && this.grounded(j)) return;
    this.confused[j] = 2 + Math.floor(this.random() * 4);
    this.pushNote(j, NOTE.STATUS, NOTE_CONFUSION);
  }

  /** Number of hits for one use of a multi-hit move (Skill Link: the most; Loaded Dice: four or five, or 4 to 10 for Population Bomb). */
  private hitCount(i: number, mv: MBMove): number {
    if (!mv.hits) return 1;
    const [lo, hi] = mv.hits;
    const row = this.rows[this.sp[i]];
    const dice = row.loadedDice && !this.itemGone[i];
    if (lo === hi) return dice && hi === 10 ? 10 - Math.floor(this.random() * 7) : lo;
    if (row.skillLink) return hi;
    if (lo === 2 && hi === 5) {
      if (dice) return this.random() < 0.5 ? 4 : 5;
      const r = this.random();
      return r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5;
    }
    if (dice && hi >= 4) return hi;
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  private critChance(i: number, j: number, mv: MBMove): number {
    if (this.rows[this.sp[j]].critImmune) return 0;
    const stage = mv.crit + this.rows[this.sp[i]].critBoost;
    return stage >= 3 ? 1 : stage === 2 ? 0.5 : stage === 1 ? 0.125 : 1 / 24;
  }

  /** The move it uses as its turn comes: the one planned, if it can still reach; otherwise the best it can reach. */
  private chooseNow(i: number, t: number): { slot: number; spreadCount: number } {
    const spi = this.sp[i];
    const moves = this.prep.moves[spi];
    const row = this.rows[spi];
    const gapT = this.gap(i, t);
    const never = this.prep.behaviour[this.side[i]].spread === "never";
    const reach = (mv: MBMove) => gapT <= (mv.contact ? CONTACT_REACH : RANGED_REACH);
    const spreadCount = (mv: MBMove) => (mv.spread ? this.foesNear(i, this.x[i], this.z[i], row.radius + SPREAD_REACH) : 0);
    const planned = this.plan[i];
    const locked = this.rampLeft[i] > 0 && this.rampSlot[i] >= 0 ? this.rampSlot[i] : this.itemGone[i] ? -1 : this.lock[i];
    if (locked >= 0) {
      const mv = moves[locked];
      return reach(mv) ? { slot: locked, spreadCount: spreadCount(mv) } : { slot: -1, spreadCount: 0 };
    }
    // As in the games, the move chosen as the round began is the one used (on its new target if the first one fell),
    // unless the battlefield has put it out of reach.
    // (On a battlefield a new target can be one the planned move can't touch at all: then it picks again.)
    if (planned >= 0 && planned < moves.length && reach(moves[planned]) && (t === this.planTarget[i] || this.expected(i, planned, t, false) > 0)) return { slot: planned, spreadCount: spreadCount(moves[planned]) };
    let best = -1, bestV = 0, bestCount = 0;
    // "Never" passes over spread moves unless nothing else can hurt the target.
    for (const skipSpread of never ? [true, false] : [false]) {
      for (let s = 0; s < moves.length; s++) {
        const mv = moves[s];
        if (!reach(mv) || (skipSpread && mv.spread)) continue;
        let v: number;
        let count = 0;
        if (mv.spread) {
          count = spreadCount(mv);
          if (count >= 2) {
            v = 0;
            for (let k = 0; k < count; k++) v += this.expected(i, s, this.scratch[k], true);
          } else v = this.expected(i, s, t, false);
        } else v = this.expected(i, s, t, false);
        if (v > bestV) { bestV = v; best = s; bestCount = count; }
      }
      if (best >= 0) break;
    }
    return { slot: best, spreadCount: bestCount };
  }

  /** Stance Change and Protean or Libero change the user as it attacks: Blade Forme; the move's type (once). */
  private formForMove(i: number, slot: number, mv: MBMove) {
    const rule = this.rows[this.sp[i]].formRule;
    if (rule === "stance" && this.form[i] === 0) this.setForm(i, 1);
    else if (rule === "protean" && this.form[i] === 0) {
      const t = mv.type.toLowerCase();
      const now = this.typesOf(i);
      if (now.length !== 1 || now[0] !== t) this.setForm(i, slot + 1);
    }
  }

  private setForm(i: number, f: number) {
    if (this.form[i] === f) return;
    this.form[i] = f;
    this.pushNote(i, NOTE.FORM, f);
  }

  /** One use of a move by `i` against its target (and, for a spread move, everyone around), hit by hit as the games play it. */
  private act(i: number) {
    let t = this.target[i];
    if (t < 0 || !this.alive[t]) {
      t = this.target[i] = this.findTarget(i);
      if (t < 0) return;
    }
    const spi = this.sp[i];
    const row = this.rows[spi];
    const { slot: best, spreadCount } = this.chooseNow(i, t);
    if (best < 0) return;
    const mv = this.prep.moves[spi][best];
    this.actedRound[i] = this.round;
    this.idleSince = this.tick;
    if (this.skipsTurn(i, mv)) return;
    this.actionId++;
    this.formForMove(i, best, mv);
    let targets: number;
    if (mv.spread && spreadCount >= 2) {
      targets = this.foesNear(i, this.x[i], this.z[i], row.radius + SPREAD_REACH);
    } else {
      this.scratch[0] = t;
      targets = 1;
    }
    // The scratch buffer is reused below (Moxie, contact chip): copy the targets out.
    if (this.hitScratch.length < targets * 3) this.hitScratch = new Int32Array(targets * 6);
    const hitList = this.hitScratch;
    for (let k = 0; k < targets; k++) hitList[k] = this.scratch[k];
    const multi = targets >= 2;
    const pri = this.priority(i, best);
    let crashed = false;
    // Who it lands on: protection, accuracy and immunity, once per target.
    let landed = 0;
    for (let k = 0; k < targets; k++) {
      const j = hitList[k];
      if (!this.alive[j] || !this.alive[i]) continue;
      const flagsBase = multi ? EV.SPREAD : 0;
      if (this.blocked(i, j, mv, pri)) {
        this.pushEvent(i, j, best, 0, flagsBase | EV.IMMUNE);
        if (mv.crash) crashed = true;
        continue;
      }
      if (this.random() >= this.accuracy(i, j, mv)) {
        this.pushEvent(i, j, best, 0, flagsBase | EV.MISS);
        if (mv.crash) crashed = true;
        continue;
      }
      if (this.table.entry(spi, best, this.sp[j], this.hitState(i, j, mv, false, multi)).immune) {
        this.pushEvent(i, j, best, 0, flagsBase | EV.IMMUNE);
        if (mv.crash) crashed = true;
        this.absorb(j, mv);
        continue;
      }
      hitList[targets + landed++] = j;
    }
    // Per landed target (after the targets and the landed list in the scratch buffer): damage so far, and its flags.
    if (this.doneScratch.length < landed) this.doneScratch = new Float64Array(landed * 2);
    const done = this.doneScratch;
    const F0 = targets * 2;
    for (let k = 0; k < landed; k++) { done[k] = 0; hitList[F0 + k] = multi ? EV.SPREAD : 0; }
    // Multi-hit moves hit one target; spread moves hit once.
    const nh = landed ? (multi ? 1 : this.hitCount(i, mv)) : 0;
    const eachAcc = mv.multiAcc && !row.skillLink && !(row.loadedDice && !this.itemGone[i]);
    let total = 0, kos = 0, healed = 0, ooze = 0, hits = 0;
    for (let h = 0; h < nh && this.alive[i]; h++) {
      let any = false;
      // The damage of this hit, on every target at once.
      for (let k = 0; k < landed; k++) {
        const j = hitList[targets + k];
        hitList[F0 + k] &= ~(HIT_NOW | SHIELD);
        if (!this.alive[j] || hitList[F0 + k] & EV.MISS) continue;
        // Triple Axel, Population Bomb: every hit after the first checks accuracy again; a miss ends the move.
        if (h > 0 && eachAcc && this.random() >= this.accuracy(i, j, mv)) { hitList[F0 + k] |= EV.MISS; continue; }
        const dRow = this.rows[this.sp[j]];
        const crit = this.random() < this.critChance(i, j, mv);
        let dmg = 0;
        let shield = false;
        // Disguise (any hit) and Ice Face (a physical one, in its ice form) take a hit for it; Mold Breaker goes through.
        const dAb = this.abilityVs(i, j);
        if (!this.shieldUsed[j] && (dAb === "disguise" || (dAb === "iceface" && mv.cat === "Physical" && this.form[j] === 0))) {
          this.shieldUsed[j] = 1;
          shield = true;
        } else {
          const e: HitEntry = this.table.entry(spi, best, this.sp[j], this.hitState(i, j, mv, crit, multi));
          const rolls = e.hits[Math.min(h, e.hits.length - 1)];
          dmg = rolls[Math.floor(this.random() * 16)];
        }
        const before = this.hp[j];
        // Sturdy and Focus Sash: a Pokémon at full HP survives a hit with 1 HP (each hit of a multi-hit move on its own).
        if (dmg >= before && before >= dRow.maxHp) {
          if (dAb === "sturdy") dmg = before - 1;
          else if (this.hasItem(j, "focussash")) {
            dmg = before - 1;
            this.itemGone[j] = 1;
            this.pushNote(j, NOTE.ITEM, NOTE_ITEM.sash);
          }
        }
        const got = Math.min(dmg, before);
        this.hp[j] = before - got;
        this.dealt[i] += got;
        this.sideDealt[this.side[i]] += got;
        done[k] += got;
        total += got;
        any = true;
        let fl = hitList[F0 + k] | HIT_NOW | (shield ? SHIELD : 0) | (crit ? EV.CRIT : 0);
        if (h === 0) {
          const eff = this.effectiveness(spi, best, j);
          if (eff > 1) fl |= EV.SUPER;
          else if (eff < 1) fl |= EV.RESIST;
        }
        // Drain, target by target (Liquid Ooze turns it into damage).
        if (mv.drain && got > 0) {
          const amount = Math.round((got * mv.drain[0]) / mv.drain[1]);
          if (dRow.ability === "liquidooze") ooze += amount;
          else healed += amount;
        }
        if (this.hp[j] <= 0) {
          fl |= EV.KO;
          this.faint(j);
          this.kos[i]++;
          kos++;
          this.sideKos[this.side[i]]++;
        }
        hitList[F0 + k] = fl;
      }
      if (!any) break;
      hits++;
      if (healed > 0) { this.heal(i, healed); healed = 0; }
      if (ooze > 0) { if (!row.magicGuard) this.chip(i, ooze, -1); ooze = 0; }
      // What the hit sets off on each target it reached, in the games' order.
      for (let k = 0; k < landed; k++) {
        const fl = hitList[F0 + k];
        if (!(fl & HIT_NOW)) continue;
        const j = hitList[targets + k];
        this.afterHit(i, j, mv, this.effectiveness(spi, best, j), !!(fl & EV.CRIT));
        if (fl & SHIELD) {
          // Disguise is busted (an eighth of its HP); Ice Face's ice breaks (Noice Face).
          const dRow = this.rows[this.sp[j]];
          if (dRow.disguise) {
            this.pushNote(j, NOTE.ITEM, NOTE_ITEM.disguise);
            if (this.alive[j]) this.chip(j, Math.max(1, Math.floor(dRow.maxHp / 8)), -1);
          } else this.setForm(j, 1);
        }
      }
    }
    for (let k = 0; k < landed; k++) {
      const j = hitList[targets + k];
      const got = done[k];
      const flags = hitList[F0 + k] & ~(EV.MISS | HIT_NOW | SHIELD);
      if (this.prep.layout === "field" && got > 0) {
        // Knockback: damage over weight, away from the attacker.
        const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        const kv = Math.min(KNOCK_MAX, (KNOCK * got) / this.rows[this.sp[j]].mass);
        this.kx[j] += (dx / d) * kv;
        this.kz[j] += (dz / d) * kv;
      }
      this.pushEvent(i, j, best, got, flags);
      if (!this.bigHit || got > this.bigHit.damage) this.bigHit = { damage: got, actor: i, target: j, slot: best, crit: !!(flags & EV.CRIT) };
    }
    // High Jump Kick and the like: a miss costs half its max HP.
    if (crashed && !landed && this.alive[i] && !row.magicGuard) this.chip(i, Math.floor(row.maxHp / 2), -1);
    // Outrage and the like: locked in for two or three uses, then confused by the fatigue.
    if (mv.rampage && this.alive[i]) {
      if (this.rampLeft[i] <= 0 && hits > 0) {
        this.rampSlot[i] = best;
        this.rampLeft[i] = this.random() < 0.5 ? 2 : 3;
      }
      if (this.rampLeft[i] > 0 && --this.rampLeft[i] === 0) {
        this.rampSlot[i] = -1;
        this.confuse(i);
      }
    }
    if (!this.alive[i]) return;
    // The attacker's own after-effects, once a move use.
    if (hits > 0) {
      const max = row.maxHp;
      const sfNoRecoil = row.sheerForce && !!mv.fx?.some((f) => !f.always);
      if (total > 0) {
        let self = 0;
        if (mv.recoil && !row.noRecoil) self += Math.max(1, Math.round((total * mv.recoil[0]) / mv.recoil[1]));
        if (row.lifeOrb && !this.itemGone[i] && !row.magicGuard && !sfNoRecoil) self += Math.max(1, Math.floor(max / 10));
        if (this.hasItem(i, "shellbell")) this.heal(i, Math.max(1, Math.floor(total / 8)));
        if (self > 0) this.chip(i, self, -1);
      }
      if (this.alive[i]) {
        for (const f of mv.fx ?? []) if (f.on === "self" && f.boosts && (f.always || (!row.sheerForce && this.random() * 100 < f.chance * (row.sereneGrace ? 2 : 1)))) this.boost(i, f.boosts, false);
        if (kos) {
          if (row.ability === "moxie" || row.ability === "chillingneigh" || row.ability === "asoneglastrier") this.boost(i, { atk: kos }, false);
          else if (row.ability === "grimneigh" || row.ability === "asonespectrier") this.boost(i, { spa: kos }, false);
          else if (row.ability === "beastboost") {
            const st = this.formRow(i).stats;
            const top = (["atk", "def", "spa", "spd", "spe"] as const).reduce((a, b) => (st[b] > st[a] ? b : a), "atk" as "atk" | "def" | "spa" | "spd" | "spe");
            this.boost(i, { [top]: kos }, false);
          }
        }
        if (row.item && CHOICE.has(row.item) && !this.itemGone[i] && this.lock[i] < 0) this.lock[i] = best;
      }
    }
  }

  /**
   * What a hit that landed sets off, in Showdown's order: the move's side effects on the target (Sheer Force trades
   * them for power; Shield Dust and Covert Cloak keep them off; King's Rock adds a flinch), then the target's answers
   * and contact (its abilities and items, the attacker's Poison Touch and Toxic Chain), then Knock Off.
   */
  private afterHit(i: number, j: number, mv: MBMove, eff: number, crit: boolean) {
    const row = this.rows[this.sp[i]];
    const dRow = this.rows[this.sp[j]];
    const dAb = this.abilityVs(i, j);
    const covered = dAb === "shielddust" || this.hasItem(j, "covertcloak");
    const sg = row.sereneGrace ? 2 : 1;
    // 1. Side effects.
    if (this.alive[j] && !covered) {
      if (mv.fx && !row.sheerForce) {
        for (const f of mv.fx) {
          if (f.on !== "target") continue;
          if (this.random() * 100 >= Math.min(100, f.chance * sg)) continue;
          if (f.status) this.setStatus(j, f.status, i, true);
          if (f.flinch && this.actedRound[j] !== this.round && dAb !== "innerfocus") this.flinchRound[j] = this.round;
          if (f.confuse) this.confuse(j, i);
          if (f.boosts) this.boost(j, f.boosts, true, i);
        }
      }
      // King's Rock: a 10% flinch on moves that have none of their own.
      if (this.hasItem(i, "kingsrock") && !mv.fx?.some((f) => f.flinch) && this.random() * 100 < 10 * sg && this.actedRound[j] !== this.round && dAb !== "innerfocus") this.flinchRound[j] = this.round;
    }
    // 2. The target's answers to being hit (they come even when Disguise took the damage).
    if (this.alive[j]) {
      // A frozen target thaws when a Fire move (or Scald) hits it.
      if (this.status[j] === STATUS.frz && (mv.type === "Fire" || toId(mv.name) === "scald" || toId(mv.name) === "scorchingsands" || toId(mv.name) === "steameruption")) {
        this.status[j] = 0;
        this.pushNote(j, NOTE.CURE, STATUS.frz);
      }
      const ab = dRow.ability;
      if (ab === "stamina") this.boost(j, { def: 1 }, false);
      else if (ab === "justified" && mv.type === "Dark") this.boost(j, { atk: 1 }, false);
      else if (ab === "weakarmor" && mv.cat === "Physical") this.boost(j, { def: -1, spe: 2 }, false);
      else if (ab === "angerpoint" && crit) this.boost(j, { atk: 12 }, false);
      else if (ab === "rattled" && (mv.type === "Bug" || mv.type === "Ghost" || mv.type === "Dark")) this.boost(j, { spe: 1 }, false);
      else if (ab === "steamengine" && (mv.type === "Fire" || mv.type === "Water")) this.boost(j, { spe: 6 }, false);
      else if (ab === "watercompaction" && mv.type === "Water") this.boost(j, { def: 2 }, false);
      else if (ab === "thermalexchange" && mv.type === "Fire") this.boost(j, { atk: 1 }, false);
      if (this.hasItem(j, "weaknesspolicy") && eff > 1) {
        this.itemGone[j] = 1;
        this.pushNote(j, NOTE.ITEM, NOTE_ITEM.weaknessPolicy);
        this.boost(j, { atk: 2, spa: 2 }, false);
      }
      if (this.hasItem(j, "airballoon")) {
        this.itemGone[j] = 1;
        this.pushNote(j, NOTE.ITEM, NOTE_ITEM.balloon);
      }
    }
    // Contact: the target's ability or Rocky Helmet strikes back (even as it faints); Punching Glove keeps punches off.
    const contact = mv.contact && !row.contactProof && !(mv.punch && this.hasItem(i, "punchingglove"));
    if (contact && this.alive[i]) {
      const ab = dRow.ability;
      if (ab === "static" || ab === "flamebody" || ab === "poisonpoint") {
        if (this.random() < 0.3) this.setStatus(i, ab === "static" ? "par" : ab === "flamebody" ? "brn" : "psn", j);
      } else if (ab === "effectspore" && !this.typesOf(i).includes("grass") && row.ability !== "overcoat" && !this.hasItem(i, "safetygoggles")) {
        const r = this.random() * 100;
        if (r < 11) this.setStatus(i, "slp", j);
        else if (r < 21) this.setStatus(i, "par", j);
        else if (r < 30) this.setStatus(i, "psn", j);
      } else if (ab === "gooey" || ab === "tanglinghair") this.boost(i, { spe: -1 }, true);
      if (row.ability === "poisontouch" && this.alive[j] && !covered && this.random() < 0.3) this.setStatus(j, "psn", i);
      if (!row.magicGuard) {
        if (ab === "roughskin" || ab === "ironbarbs") this.chip(i, Math.max(1, Math.floor(row.maxHp / 8)), j);
        if (this.alive[i] && this.hasItem(j, "rockyhelmet")) this.chip(i, Math.max(1, Math.floor(row.maxHp / 6)), j);
      }
    }
    // Toxic Chain: any hit may badly poison the target.
    if (row.ability === "toxicchain" && this.alive[j] && !covered && this.random() < 0.3) this.setStatus(j, "tox", i);
    if (this.alive[j]) this.checkBerry(j);
    // 3. Knock Off takes the item (not a Mega Stone, not through Sticky Hold).
    if (this.alive[i] && this.alive[j] && toId(mv.name) === "knockoff" && !this.itemGone[j] && !dRow.mega && dAb !== "stickyhold") {
      this.itemGone[j] = 1;
      this.lock[j] = -1;
      this.pushNote(j, NOTE.ITEM, NOTE_ITEM.knockedOff, i);
    }
  }

  /** Abilities that take a move in (Lightning Rod, Volt Absorb, Sap Sipper…): the immunity is the calculator's, the boost or healing is here. */
  private absorb(j: number, mv: MBMove) {
    const row = this.rows[this.sp[j]];
    const ab = row.ability, t = mv.type;
    const heal = (ab === "voltabsorb" && t === "Electric") || ((ab === "waterabsorb" || ab === "dryskin") && t === "Water") || (ab === "eartheater" && t === "Ground");
    if (heal) return this.heal(j, Math.floor(row.maxHp / 4));
    if ((ab === "lightningrod" && t === "Electric") || (ab === "stormdrain" && t === "Water")) this.boost(j, { spa: 1 }, false);
    else if (ab === "motordrive" && t === "Electric") this.boost(j, { spe: 1 }, false);
    else if (ab === "sapsipper" && t === "Grass") this.boost(j, { atk: 1 }, false);
    else if (ab === "wellbakedbody" && t === "Fire") this.boost(j, { def: 2 }, false);
  }

  /** Whether anything happens at the end of a round at all (most battles: nothing until someone is poisoned or burned). */
  private residualAny = false;
  /** Fighters with an item or ability that acts at the end of a round. */
  private residualFighters = false;

  /** The end of a round, as in the games: sandstorm, Grassy Terrain, Shed Skin and Hydration, Leftovers, poison and burns, Speed Boost, then Schooling and Shields Down. */
  private endOfRound() {
    const f = this.prep.field;
    if (!this.residualAny && !this.residualFighters && f.weather !== "sand" && f.terrain !== "grassy") return;
    const order: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.alive[i]) order.push(i);
    order.sort((a, b) => this.effectiveSpeed(b) - this.effectiveSpeed(a) || a - b);
    const each = (fn: (i: number, row: FighterRow) => void) => {
      for (const i of order) if (this.alive[i]) fn(i, this.rows[this.sp[i]]);
    };
    if (f.weather === "sand") {
      each((i, row) => {
        if (this.typesOf(i).some((t) => t === "rock" || t === "ground" || t === "steel") || SAND_IMMUNE_ABILITIES.has(row.ability) || this.hasItem(i, "safetygoggles")) return;
        this.chip(i, Math.max(1, Math.floor(row.maxHp / 16)), -1, EV.RECOIL | EV.RESIDUAL);
      });
    }
    each((i, row) => {
      const max = row.maxHp;
      if (f.weather === "rain" && (row.ability === "raindish" || row.ability === "dryskin")) this.heal(i, Math.floor(max / (row.ability === "dryskin" ? 8 : 16)));
      if (f.weather === "snow" && row.ability === "icebody") this.heal(i, Math.floor(max / 16));
      if (f.weather === "sun" && (row.ability === "dryskin" || row.ability === "solarpower") && !row.magicGuard) this.chip(i, Math.max(1, Math.floor(max / 8)), -1, EV.RECOIL | EV.RESIDUAL);
    });
    if (f.terrain === "grassy") each((i, row) => { if (this.grounded(i)) this.heal(i, Math.floor(row.maxHp / 16)); });
    // Shed Skin (a third of the time) and Hydration (in the rain) cure a status.
    each((i, row) => {
      const st = this.status[i];
      if (!st || !((row.ability === "shedskin" && this.random() < 0.33) || (row.ability === "hydration" && f.weather === "rain"))) return;
      this.status[i] = 0;
      this.pushNote(i, NOTE.CURE, st);
    });
    each((i, row) => {
      if (this.hasItem(i, "leftovers")) this.heal(i, Math.floor(row.maxHp / 16));
      else if (this.hasItem(i, "blacksludge")) {
        if (this.typesOf(i).includes("poison")) this.heal(i, Math.floor(row.maxHp / 16));
        else if (!row.magicGuard) this.chip(i, Math.max(1, Math.floor(row.maxHp / 8)), -1, EV.RECOIL | EV.RESIDUAL);
      }
    });
    each((i, row) => {
      const st = this.status[i];
      if (st !== STATUS.psn && st !== STATUS.tox) return;
      if (row.ability === "poisonheal") return this.heal(i, Math.floor(row.maxHp / 8));
      if (row.magicGuard) return;
      if (st === STATUS.tox) this.toxic[i] = Math.min(15, this.toxic[i] + 1);
      const amount = st === STATUS.tox ? Math.floor((row.maxHp * this.toxic[i]) / 16) : Math.floor(row.maxHp / 8);
      this.chip(i, Math.max(1, amount), -1, EV.RECOIL | EV.RESIDUAL);
    });
    each((i, row) => {
      if (this.status[i] !== STATUS.brn || row.magicGuard) return;
      this.chip(i, Math.max(1, Math.floor(row.maxHp / (row.ability === "heatproof" ? 32 : 16))), -1, EV.RECOIL | EV.RESIDUAL);
    });
    each((i, row) => {
      if (row.ability === "speedboost") this.boost(i, { spe: 1 }, false);
    });
    // Schooling (from level 20) and Shields Down change form by the HP left.
    each((i, row) => {
      if (row.formRule === "school" && this.prep.sets[this.sp[i]].level >= 20) this.setForm(i, this.hp[i] * 4 > row.maxHp ? 1 : 0);
      else if (row.formRule === "shields") this.setForm(i, this.hp[i] * 2 > row.maxHp ? 0 : 1);
    });
  }

  /** Type effectiveness of fighter `a`'s move on unit `j` in its form (for the hit's flash and sound, and Weakness Policy). */
  private effectiveness(a: number, slot: number, j: number): number {
    const d = this.sp[j];
    const key = ((a * 8 + slot) * 65536 + d) * 8 + this.form[j];
    let v = this.effCache.get(key);
    if (v === undefined) {
      v = typeFactor(this.prep.moves[a][slot].type, this.typesOf(j));
      this.effCache.set(key, v);
    }
    return v;
  }

  // -------------------------------------------------------------------------
  // Moving
  // -------------------------------------------------------------------------

  private move() {
    const { n, alive, x, z } = this;
    const decay = Math.exp(-KNOCK_DECAY * DT);
    const released = this.tick - this.idleSince >= HOLD_IDLE_TICKS;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) { this.vx[i] = this.vz[i] = 0; continue; }
      let t = this.target[i];
      if (t < 0 || !alive[t]) t = this.target[i] = this.findTarget(i);
      const row = this.rows[this.sp[i]];
      let mx = 0, mz = 0;
      if (t >= 0) {
        const dx = x[t] - x[i], dz = z[t] - z[i];
        const d = Math.sqrt(dx * dx + dz * dz);
        const gap = d - row.radius - this.rows[this.sp[t]].radius;
        const slot = this.plan[i];
        const ranged = slot >= 0 && !this.prep.moves[this.sp[i]][slot].contact;
        const want = ranged ? RANGED_REACH * 0.7 : 0.05;
        // Holding the line: it steps up only to a foe that has come close (or once the field has been quiet a while).
        const holding = this.prep.behaviour[this.side[i]].stance === "hold" && !released && gap > want + HOLD_ENGAGE;
        if (!holding && gap > want && d > 1e-6) {
          const ux = dx / d, uz = dz / d;
          // A unit the crowd pushed back last tick doesn't press on into it (no piling up behind the front).
          const pushedBack = Math.max(0, -(this.lx[i] * ux + this.lz[i] * uz));
          const step = Math.max(0, Math.min(row.vmax * DT, gap - want) - pushedBack * 1.2);
          // Someone right in front: step round them instead of into them.
          const side = this.small[i] ? this.blocker(i, t, ux, uz, step) : 0;
          if (side !== 0) {
            const slide = Math.min(step, row.vmax * DT) * 0.6;
            mx = -uz * side * slide;
            mz = ux * side * slide;
          } else {
            mx = ux * step;
            mz = uz * step;
          }
        }
      }
      x[i] += mx + this.kx[i] * DT;
      z[i] += mz + this.kz[i] * DT;
      this.vx[i] = mx / DT;
      this.vz[i] = mz / DT;
      this.kx[i] *= decay;
      this.kz[i] *= decay;
      if (Math.abs(this.kx[i]) < 1e-3) this.kx[i] = 0;
      if (Math.abs(this.kz[i]) < 1e-3) this.kz[i] = 0;
    }
  }

  /**
   * Whether a body blocks `i`'s way to `t` this step: 0 if the way is clear, otherwise the side (±1, across the
   * direction of travel) to step round it, away from the blocker.
   */
  private blocker(i: number, t: number, ux: number, uz: number, step: number): number {
    const cols = this.cols, a = this.arena, size = this.cell;
    const xi = this.x[i], zi = this.z[i], ri = this.rows[this.sp[i]].radius;
    const gx = Math.min(cols - 1, Math.max(0, Math.floor((xi + a) / size)));
    const gz = Math.min(cols - 1, Math.max(0, Math.floor((zi + a) / size)));
    let nearest = Infinity, lateral = 0;
    for (let zz = Math.max(0, gz - 1); zz <= Math.min(cols - 1, gz + 1); zz++) {
      for (let xx = Math.max(0, gx - 1); xx <= Math.min(cols - 1, gx + 1); xx++) {
        const c = zz * cols + xx;
        for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
          const j = this.cellItems[k];
          if (j === i || j === t || !this.alive[j]) continue;
          const dx = this.x[j] - xi, dz = this.z[j] - zi;
          const ahead = dx * ux + dz * uz;
          if (ahead <= 0) continue;
          const across = -dx * uz + dz * ux;
          const reach = ri + this.rows[this.sp[j]].radius;
          if (Math.abs(across) >= reach * 0.85 || ahead > reach + step) continue;
          if (ahead < nearest) { nearest = ahead; lateral = across; }
        }
      }
    }
    if (nearest === Infinity) return 0;
    // Step to the side the blocker isn't on (a fixed side when it's dead ahead, by index, so crowds fan out).
    return lateral > 1e-6 ? -1 : lateral < -1e-6 ? 1 : (i & 1 ? 1 : -1);
  }

  /** Bodies push each other apart (heavier ones push harder), and everyone stays on the field. */
  private separate() {
    const { n, alive, x, z } = this;
    const cx = this.cx, cz = this.cz;
    cx.fill(0);
    cz.fill(0);
    const cols = this.cols;
    const pair = (i: number, j: number) => {
      const dx = x[j] - x[i], dz = z[j] - z[i];
      const ri = this.rows[this.sp[i]].radius, rj = this.rows[this.sp[j]].radius;
      const min = ri + rj;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) return;
      let d = Math.sqrt(d2), ux: number, uz: number;
      if (d < 1e-6) {
        // Exactly on top of each other: part them along a direction fixed by their indices.
        const a = ((i * 7919 + j * 104729) % 360) * (Math.PI / 180);
        ux = Math.cos(a);
        uz = Math.sin(a);
        d = 0;
      } else {
        ux = dx / d;
        uz = dz / d;
      }
      const push = (min - d) * 0.5;
      const mi = this.rows[this.sp[i]].mass, mj = this.rows[this.sp[j]].mass;
      const wi = mj / (mi + mj), wj = mi / (mi + mj);
      cx[i] -= ux * push * wi;
      cz[i] -= uz * push * wi;
      cx[j] += ux * push * wj;
      cz[j] += uz * push * wj;
    };
    // Small bodies against small bodies: their own cell and the neighbours ahead of it.
    for (let c = 0; c < cols * cols; c++) {
      const s0 = this.cellStart[c], s1 = this.cellStart[c + 1];
      if (s0 === s1) continue;
      const gx = c % cols, gz = (c - gx) / cols;
      for (let a = s0; a < s1; a++) {
        const i = this.cellItems[a];
        for (let b = a + 1; b < s1; b++) pair(i, this.cellItems[b]);
        // Neighbour cells: east, and the three below (each pair of cells is visited once).
        const east = gx + 1 < cols, below = gz + 1 < cols;
        if (east) for (let b = this.cellStart[c + 1]; b < this.cellStart[c + 2]; b++) pair(i, this.cellItems[b]);
        if (below) {
          const lo = gx > 0 ? c + cols - 1 : c + cols, hi = east ? c + cols + 1 : c + cols;
          for (let b = this.cellStart[lo]; b < this.cellStart[hi + 1]; b++) pair(i, this.cellItems[b]);
        }
      }
    }
    // Big bodies against everyone near them.
    for (let k = 0; k < this.bigCount; k++) {
      const i = this.bigUnits[k];
      if (!alive[i]) continue;
      const r = this.rows[this.sp[i]].radius + this.cell;
      const g0x = Math.max(0, Math.floor((x[i] - r + this.arena) / this.cell)), g1x = Math.min(cols - 1, Math.floor((x[i] + r + this.arena) / this.cell));
      const g0z = Math.max(0, Math.floor((z[i] - r + this.arena) / this.cell)), g1z = Math.min(cols - 1, Math.floor((z[i] + r + this.arena) / this.cell));
      for (let gz = g0z; gz <= g1z; gz++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          const c = gz * cols + gx;
          for (let b = this.cellStart[c]; b < this.cellStart[c + 1]; b++) pair(i, this.cellItems[b]);
        }
      }
      for (let k2 = k + 1; k2 < this.bigCount; k2++) {
        const j = this.bigUnits[k2];
        if (alive[j]) pair(i, j);
      }
    }
    const lim = this.arena;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      x[i] += cx[i];
      z[i] += cz[i];
      this.lx[i] = this.lx[i] * 0.5 + cx[i];
      this.lz[i] = this.lz[i] * 0.5 + cz[i];
      const r = this.rows[this.sp[i]].radius;
      const d = Math.sqrt(x[i] * x[i] + z[i] * z[i]);
      const max = lim - r;
      if (d > max && d > 0) {
        x[i] *= max / d;
        z[i] *= max / d;
      }
    }
  }

  /** Whether a side can still hurt the other at all. */
  private canStillHurt(s: number): boolean {
    const F = this.prep.species.length;
    for (const [a] of this.prep.armies[s]) {
      if (!this.aliveByFighter[a]) continue;
      for (const [d] of this.prep.armies[1 - s]) if (this.aliveByFighter[d] && this.canHurt[a * F + d]) return true;
    }
    return false;
  }

  private checkEnd(): boolean {
    if (this.left[0] && this.left[1]) return false;
    this.ended = true;
    this.winner = !this.left[0] && !this.left[1] ? (this.lastFaintSide >= 0 ? (this.lastFaintSide as 0 | 1) : 2) : this.left[0] ? 0 : 1;
    return true;
  }

  /** One tick (1/20 s). */
  step() {
    this.eventCount = 0;
    this.noteCount = 0;
    if (this.ended) return;
    if (this.tick % ROUND_TICKS === 0) {
      if (this.tick > 0) {
        this.endOfRound();
        if (this.checkEnd()) { this.tick++; return; }
      }
      this.startRound();
      if (!this.canStillHurt(0) && !this.canStillHurt(1)) {
        this.ended = true;
        this.winner = 2;
        return;
      }
    }
    // Everyone whose turn has come this tick, in turn order.
    while (this.orderAt < this.orderLen) {
      const i = this.order[this.orderAt];
      if (this.actTick[i] > this.tick) break;
      this.orderAt++;
      if (this.alive[i]) this.act(i);
      if (!this.left[0] || !this.left[1]) break;
    }
    if (this.prep.layout === "field") {
      // Retargeting spread over the round: each unit looks for a better foe once a round, and more often while it's
      // still heading for a far one.
      for (let i = this.tick % ROUND_TICKS; i < this.n; i += ROUND_TICKS) if (this.alive[i]) this.target[i] = this.findTarget(i);
      for (let i = this.tick % TICK_HZ; i < this.n; i += TICK_HZ) if (this.alive[i] && this.far[i]) this.target[i] = this.findTarget(i);
      this.move();
      this.rebuildGrids();
      this.separate();
      this.separate();
    } else {
      for (let i = 0; i < this.n; i++) if (this.alive[i] && (this.target[i] < 0 || !this.alive[this.target[i]])) this.target[i] = this.findTarget(i);
    }
    this.tick++;
    if (this.checkEnd()) return;
    if (this.tick >= MAX_SECONDS * TICK_HZ) {
      this.ended = true;
      this.winner = 2;
    }
  }

  outcome(): BattleOutcome {
    return { winner: this.winner, seconds: this.tick / TICK_HZ, left: [this.left[0], this.left[1]], kos: [this.sideKos[0], this.sideKos[1]], dealt: [Math.round(this.sideDealt[0]), Math.round(this.sideDealt[1])] };
  }

  stats(): BattleStats {
    let mvp = -1, mvpKos = 0;
    for (let i = 0; i < this.n; i++) if (this.kos[i] > mvpKos) { mvpKos = this.kos[i]; mvp = i; }
    return { mvp, mvpKos, big: this.bigHit };
  }

  /** Total HP left on a side, as a share of its starting HP. */
  hpShare(s: number): number {
    let cur = 0, max = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.side[i] !== s) continue;
      max += this.rows[this.sp[i]].maxHp;
      cur += this.hp[i];
    }
    return max ? cur / max : 0;
  }
}

/** What a move's chance to hit depends on. */
export interface AccuracyInput {
  mv: MBMove;
  /** Ability and held item ids ("" for none). */
  aAbility: string;
  aItem: string;
  dAbility: string;
  dItem: string;
  /** The user's accuracy stage and the target's evasion stage. */
  accStage: number;
  evaStage: number;
  weather: FieldSpec["weather"];
  /** The target has already moved this turn (Zoom Lens). */
  targetMoved: boolean;
}

/** Chance a move lands, as in the games: its accuracy with the stages, abilities (No Guard, Compound Eyes, Hustle, Victory Star, Sand Veil, Snow Cloak), items (Wide Lens, Zoom Lens, Bright Powder) and the weather (Thunder and Hurricane in rain or sun, Blizzard in snow). */
export function hitChance(x: AccuracyInput): number {
  const id = toId(x.mv.name);
  const w = x.weather;
  if ((id === "thunder" || id === "hurricane") && w === "rain") return 1;
  if (id === "blizzard" && w === "snow") return 1;
  let acc = x.mv.acc;
  if (!acc) return 1;
  if (x.aAbility === "noguard" || x.dAbility === "noguard") return 1;
  if ((id === "thunder" || id === "hurricane") && w === "sun") acc = 50;
  const stage = Math.max(-6, Math.min(6, x.accStage - x.evaStage));
  let p = (acc / 100) * accMul(stage);
  if (x.aAbility === "compoundeyes") p *= 1.3;
  if (x.aAbility === "victorystar") p *= 1.1;
  if (x.aAbility === "hustle" && x.mv.cat === "Physical") p *= 0.8;
  if (x.aItem === "widelens") p *= 1.1;
  if (x.aItem === "zoomlens" && x.targetMoved) p *= 1.2;
  if (x.dItem === "brightpowder") p *= 0.9;
  if ((x.dAbility === "sandveil" && w === "sand") || (x.dAbility === "snowcloak" && w === "snow")) p *= 0.8;
  return Math.min(1, p);
}

/** Expected hits of one use of a move (Skill Link always hits five times, Loaded Dice four or five). */
export function expectedHits(mv: MBMove, ability: string, item: string): number {
  if (!mv.hits) return 1;
  if (ability === "skilllink") return mv.hits[1];
  if (item === "loadeddice" && mv.hits[1] >= 4) return mv.hits[0] === 2 && mv.hits[1] === 5 ? 4.5 : mv.hits[1];
  return expectedHitsOf(mv);
}

/** Expected damage of one use on one target, capped at the HP it has left: the policy every Pokémon fights by. */
export function expectedDamage(table: DamageTable, a: number, slot: number, d: number, st: HitState, chance: number, hits: number, targetHp: number): number {
  const e = table.entry(a, slot, d, st);
  if (e.immune) return 0;
  return Math.min(targetHp, e.avg * hits) * chance;
}

/** Puts the stat stages a move reads into a hit state: its attacking stat (Body Press: Defense, Foul Play: the target's Attack) and the defending one. */
export function setStages(st: HitState, mv: MBMove, aAtk: number, aDef: number, aSpa: number, dAtk: number, dDef: number, dSpd: number) {
  const s = mv.atkStat;
  st.aStage = s === "def" ? aDef : s === "target-atk" ? dAtk : s === "best" ? aAtk : mv.cat === "Physical" ? aAtk : aSpa;
  st.aStage2 = s === "best" ? aSpa : 0;
  st.dStage = s === "best" ? dDef : mv.cat === "Physical" || mv.hitsDef ? dDef : dSpd;
  st.dStage2 = s === "best" ? dSpd : 0;
}

/** The type chart, for the hit's look and sound (damage itself is the calculator's). */
export function typeFactor(moveType: string, defender: string[]): number {
  try {
    return chart(moveType.toLowerCase() as PokemonType, defender as PokemonType[]);
  } catch {
    return 1;
  }
}

/** Plays a battle to the end without drawing it. */
export function runHeadless(prep: Prepared, table?: DamageTable, maxTicks = MAX_SECONDS * TICK_HZ): Battle {
  const b = new Battle(prep, table);
  while (!b.ended && b.tick < maxTicks) b.step();
  return b;
}
