import * as CalcLib from "@smogon/calc";
import type { Generation } from "@pkmn/data";
import { makePokemon, sideFromSet, type CalcModule } from "@/lib/battle/calc";
import type { TeamSet } from "@/lib/battle/sets";
import { STATUS_IDS, type FieldSpec, type MBMove, type MBSpecies, type UnitSet } from "./types";

/**
 * Damage, exactly as the games work it out: every number a hit can do comes
 * from Smogon's damage calculator (@smogon/calc, the one Showdown uses), so
 * STAB, the type chart, abilities (Huge Power, Levitate, Thick Fat…), items,
 * weather, terrain, Terastallization, stat stages, burns and the 16 random
 * rolls are the real ones. The Pokémon are built through the site's own
 * calculator glue (src/lib/battle/calc.ts).
 *
 * A battle has a few fighters (a species and its set) but thousands of
 * hits, so the table works each (attacker, move, defender) out once per
 * state and every hit after that is a lookup plus a seeded roll. The things
 * that change a hit mid-battle are part of the key: a critical hit, a
 * spread move hitting more than one foe (the 0.75 multiplier of the games'
 * double battles), the stat stages the move reads, both sides' status, a
 * Knocked Off item, the HP-dependent cases (Flail and Reversal,
 * Eruption and Water Spout, Blaze-style abilities, Multiscale, Brine,
 * Crush Grip), the form each side is in (Stance Change, Schooling, Shields
 * Down, Ice Face, Protean and Libero: see formsOf) and Slow Start.
 */

const GEN = CalcLib.Generations.get(9);
const CALC = { gen: GEN as unknown as Generation, lib: CalcLib as unknown as CalcModule };

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const PINCH: Record<string, string> = { blaze: "Fire", torrent: "Water", overgrow: "Grass", swarm: "Bug" };
const FULL_HP_SHIELDS = new Set(["multiscale", "shadowshield", "terashell"]);
const WEATHER: Record<FieldSpec["weather"], string | undefined> = { none: undefined, sun: "Sun", rain: "Rain", sand: "Sand", snow: "Snow" };
const TERRAIN: Record<FieldSpec["terrain"], string | undefined> = { none: undefined, electric: "Electric", grassy: "Grassy", psychic: "Psychic", misty: "Misty" };

/** One fighter: a species and its set. */
export interface Fighter {
  species: MBSpecies;
  set: UnitSet;
}

/**
 * Abilities that change a Pokémon's form or type mid-battle, as Showdown
 * plays them (form 0 is how it starts):
 * - "stance": Aegislash turns to Blade Forme as it attacks (and stays, with
 *   no King's Shield to turn it back).
 * - "school": Wishiwashi is in School Form from level 20 while its HP is
 *   over a quarter (checked at the start and the end of each round).
 * - "shields": Minior is in Meteor Form (immune to status) while its HP is
 *   over half, Core Form otherwise (the same checks).
 * - "iceface": Eiscue's ice takes the first physical hit, then it is Noice.
 * - "protean": Protean and Libero turn the user into its move's type the
 *   first time it uses a move of another type (once, as in Gen 9); form
 *   k + 1 is the type of move slot k. Not when Terastallized.
 */
export type FormRule = "" | "stance" | "school" | "shields" | "iceface" | "protean";

export interface FormDef {
  /** The calculator's species. */
  calc: string;
  /** Types in this form, when they aren't the species' own (capitalised). */
  types?: string[];
  /** Protean has done its work: the calculator no longer gives every move STAB. */
  spent?: boolean;
}

export function formsOf(f: Fighter): { rule: FormRule; forms: FormDef[] } {
  const ab = toId(f.set.ability);
  const calc = f.species.calc;
  if (ab === "stancechange" && calc.startsWith("Aegislash")) return { rule: "stance", forms: [{ calc: "Aegislash-Shield" }, { calc: "Aegislash-Blade" }] };
  if (ab === "schooling" && calc.startsWith("Wishiwashi")) return { rule: "school", forms: [{ calc: "Wishiwashi" }, { calc: "Wishiwashi-School" }] };
  if (ab === "shieldsdown" && calc.startsWith("Minior")) return { rule: "shields", forms: [{ calc: "Minior-Meteor" }, { calc: "Minior" }] };
  if (ab === "iceface" && calc === "Eiscue") return { rule: "iceface", forms: [{ calc: "Eiscue" }, { calc: "Eiscue-Noice" }] };
  if ((ab === "protean" || ab === "libero") && !f.set.tera && f.set.moves.length) {
    return { rule: "protean", forms: [{ calc }, ...f.set.moves.map((m) => ({ calc, types: [m.type], spent: true }))] };
  }
  return { rule: "", forms: [{ calc }] };
}

/**
 * Gives a calculator Pokémon other types, for good: calculate() works on clones, and clone() rebuilds the species by
 * merging it into the Pokédex entry index by index (one type over two would keep the second), so every clone gets the
 * types again.
 */
function withTypes(p: CalcLib.Pokemon, types: CalcLib.Pokemon["types"]): CalcLib.Pokemon {
  const clone = p.clone;
  (p.species as { types: CalcLib.Pokemon["types"] }).types = types;
  p.types = types;
  p.clone = function (this: CalcLib.Pokemon) {
    return withTypes(clone.call(this), types);
  };
  return p;
}

/** The calculator's Pokémon for a fighter (in one of its forms). */
export function calcPokemon(f: Fighter, form?: FormDef): CalcLib.Pokemon {
  const { species: s, set } = f;
  const team = {
    name: s.name,
    species: form?.calc ?? s.calc,
    item: set.item,
    ability: set.ability,
    moves: set.moves.map((m) => m.name),
    nature: set.nature,
    gender: "",
    evs: { ...set.evs },
    ivs: { ...set.ivs },
    level: set.level,
    teraType: set.tera || undefined,
  } as unknown as TeamSet;
  const side = sideFromSet(team);
  side.terastallized = !!set.tera;
  const p = makePokemon(CALC, side) as unknown as CalcLib.Pokemon;
  // Protosynthesis and Quark Drive boost the best stat in sun or on Electric Terrain (the calculator checks the field).
  const ab = toId(set.ability);
  if (ab === "protosynthesis" || ab === "quarkdrive") (p as unknown as { boostedStat?: string }).boostedStat = "auto";
  if (form?.types) withTypes(p, form.types as CalcLib.Pokemon["types"]);
  // A Pokémon whose Protean has worked no longer gets STAB on every move (a damage-neutral ability stands in).
  if (form?.spent) p.ability = "Pressure" as CalcLib.Pokemon["ability"];
  return p;
}

/** The calculator's field for a battle's weather and terrain, in singles or (for spread moves) doubles. */
export function calcField(field: FieldSpec, doubles: boolean): CalcLib.Field {
  return new CalcLib.Field({ gameType: doubles ? "Doubles" : "Singles", weather: WEATHER[field.weather] as CalcLib.Field["weather"], terrain: TERRAIN[field.terrain] as CalcLib.Field["terrain"] });
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

/** A hit's possible damage: one array of the 16 rolls per hit (multi-hit moves have one per hit). */
export interface HitEntry {
  hits: Uint16Array[];
  /** Average damage of one hit (the first). */
  avg: number;
  /** Nothing gets through (a type immunity, Levitate, Water Absorb…). */
  immune: boolean;
}

/** Everything about the moment of a hit the damage depends on. */
export interface HitState {
  crit: boolean;
  spread: boolean;
  aHp: number;
  aMax: number;
  dHp: number;
  dMax: number;
  /** Stat stages (−6..6) the move reads: the attacking stat (for Foul Play the target's Attack) and, for moves that pick the better stat, Special Attack too. */
  aStage: number;
  aStage2: number;
  /** The defending stat's stage, and for "better stat" moves the other one. */
  dStage: number;
  dStage2: number;
  /** STATUS codes. */
  aStatus: number;
  dStatus: number;
  /** Still holding their item (Knock Off takes it). */
  aItem: boolean;
  dItem: boolean;
  /** The form each is in (see formsOf; 0 is how it starts). */
  aForm: number;
  dForm: number;
  /** The attacker's Slow Start is still holding it back (its first five turns). */
  aSlow: boolean;
}

export const neutralState = (aMax: number, dMax: number): HitState => ({ crit: false, spread: false, aHp: aMax, aMax, dHp: dMax, dMax, aStage: 0, aStage2: 0, dStage: 0, dStage2: 0, aStatus: 0, dStatus: 0, aItem: true, dItem: true, aForm: 0, dForm: 0, aSlow: false });

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

type BoostKey = "atk" | "def" | "spa" | "spd";

export class DamageTable {
  readonly fighters: Fighter[];
  readonly moves: MBMove[][];
  readonly field: FieldSpec;
  /** Each fighter's form-changing rule and the calculator's Pokémon for each of its forms. */
  readonly rules: FormRule[];
  readonly formDefs: FormDef[][];
  private mons: CalcLib.Pokemon[][];
  private calcMoves = new Map<string, CalcLib.Move>();
  private singles: CalcLib.Field;
  private doubles: CalcLib.Field;
  /** (attacker, defender, slot) → (state) → entry. */
  private cache: (Map<number, HitEntry> | undefined)[];
  private canHit = new Map<number, boolean>();
  private readonly F: number;
  /** Calculations run so far (for profiling and tests). */
  calcs = 0;

  constructor(fighters: Fighter[], field: FieldSpec) {
    this.fighters = fighters;
    this.moves = fighters.map((f) => f.set.moves);
    this.field = field;
    this.F = fighters.length;
    const forms = fighters.map(formsOf);
    this.rules = forms.map((x) => x.rule);
    this.formDefs = forms.map((x) => x.forms);
    this.mons = fighters.map((f, k) => forms[k].forms.map((form) => calcPokemon(f, form)));
    this.singles = calcField(field, false);
    this.doubles = calcField(field, true);
    this.cache = new Array(this.F * this.F * 4);
  }

  /** The calculator's HP for a fighter (the battle's own formula gives the same). */
  maxHp(f: number): number {
    return this.mons[f][0].maxHP();
  }

  /** The calculator's stats for a fighter in a form (with its nature, EVs and IVs). */
  stats(f: number, form = 0) {
    return (this.mons[f][form] ?? this.mons[f][0]).rawStats;
  }

  /** A fighter's types in a form (lowercase). */
  types(f: number, form = 0): string[] {
    return (this.mons[f][form] ?? this.mons[f][0]).types.map((t) => t.toLowerCase());
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

  /** The rolls of fighter `a`'s move `slot` against fighter `d` in `state`. */
  entry(a: number, slot: number, d: number, state: HitState): HitEntry {
    const mv = this.moves[a][slot];
    const ak = attackerKey(mv, this.fighters[a].set.ability, state.aHp, state.aMax);
    const dk = defenderKey(mv, this.fighters[d].set.ability, state.dHp, state.dMax);
    const spread = state.spread && mv.spread;
    const outer = (a * this.F + d) * 4 + slot;
    let k = state.crit ? 1 : 0;
    k = k * 2 + (spread ? 1 : 0);
    k = k * 256 + ak;
    k = k * 128 + dk;
    k = k * 13 + state.aStage + 6;
    k = k * 13 + state.aStage2 + 6;
    k = k * 13 + state.dStage + 6;
    k = k * 13 + state.dStage2 + 6;
    k = k * 7 + state.aStatus;
    k = k * 7 + state.dStatus;
    k = k * 2 + (state.aItem ? 1 : 0);
    k = k * 2 + (state.dItem ? 1 : 0);
    k = k * 5 + state.aForm;
    k = k * 5 + state.dForm;
    k = k * 2 + (state.aSlow ? 1 : 0);
    let row = this.cache[outer];
    if (!row) row = this.cache[outer] = new Map();
    let e = row.get(k);
    if (e) return e;
    e = this.compute(a, mv, d, state, spread);
    row.set(k, e);
    return e;
  }

  private compute(a: number, mv: MBMove, d: number, st: HitState, spread: boolean): HitEntry {
    this.calcs++;
    let atk = this.mons[a][st.aForm] ?? this.mons[a][0];
    let def = this.mons[d][st.dForm] ?? this.mons[d][0];
    const changesA = st.aHp < st.aMax || st.aStatus || !st.aItem || st.aSlow || (mv.atkStat !== "target-atk" && (st.aStage || st.aStage2));
    const changesD = st.dHp < st.dMax || st.dStatus || !st.dItem || st.dStage || st.dStage2 || (mv.atkStat === "target-atk" && st.aStage);
    if (changesA) {
      atk = atk.clone();
      if (st.aHp < st.aMax) atk.originalCurHP = Math.max(1, st.aHp);
      if (st.aStatus) atk.status = STATUS_IDS[st.aStatus] as CalcLib.Pokemon["status"];
      if (!st.aItem) atk.item = undefined;
      if (st.aSlow) atk.abilityOn = true;
      const b = atk.boosts as Record<BoostKey, number>;
      if (mv.atkStat === "def") b.def = st.aStage;
      else if (mv.atkStat === "best") { b.atk = st.aStage; b.spa = st.aStage2; }
      else if (mv.atkStat !== "target-atk") b[mv.cat === "Physical" ? "atk" : "spa"] = st.aStage;
    }
    if (changesD) {
      def = def.clone();
      if (st.dHp < st.dMax) def.originalCurHP = Math.max(1, st.dHp);
      if (st.dStatus) def.status = STATUS_IDS[st.dStatus] as CalcLib.Pokemon["status"];
      if (!st.dItem) def.item = undefined;
      const b = def.boosts as Record<BoostKey, number>;
      if (mv.atkStat === "target-atk") b.atk = st.aStage;
      if (mv.atkStat === "best") { b.def = st.dStage; b.spd = st.dStage2; }
      else b[mv.cat === "Physical" || mv.hitsDef ? "def" : "spd"] = st.dStage;
    }
    const hits = mv.hits ? mv.hits[1] : 1;
    try {
      const r = CalcLib.calculate(GEN, atk, def, this.move(mv.name, st.crit, hits), spread ? this.doubles : this.singles);
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
      const st = neutralState(this.maxHp(a), this.maxHp(d));
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
          const st = neutralState(this.maxHp(a), this.maxHp(d));
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
    let n = 0;
    for (const row of this.cache) n += row?.size ?? 0;
    return n;
  }
}
