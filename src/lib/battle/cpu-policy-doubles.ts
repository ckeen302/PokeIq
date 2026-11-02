import { calculate, Field, Move as CalcMove, Pokemon as CalcMon } from "@smogon/calc";
import type { Battle, Pokemon, Side } from "@pkmn/sim";
import randsets from "@/data/battle/randsets.json";
import type { BattleRequest, CpuLevel } from "@/lib/battle/play";
import { benchIndices, forcedSwitchSlots, moveSlotOptions, randomChoice, type SlotOption } from "./choices";
import { alive, calcGen, calcName, field, STAB_GUESS, toCalc, withCalcMemo } from "./cpu-policy-legacy";

/**
 * The computer opponent in double battles (Normal and Hard, and the Battle
 * Lab's Smart strategy, which the replay analysis plays both sides with).
 * One turn deep and quick enough for thousands of simulated battles: every
 * pair of choices for the two Pokémon in battle is scored together on the
 * damage calc.
 *
 * - The other side: each foe is expected to use its best move on whichever
 *   of ours it hurts most (both of them for a spread move), in turn order
 *   (priority, then speed, Trick Room and Tailwind included). Its moves are
 *   the ones it has used, then what Showdown's generator gives its species
 *   in a Random Doubles battle, else a strong STAB guess per type. It may
 *   protect (more likely when it's in danger, less right after a Protect).
 * - Our attacks: expected damage and the chance to KO each target, with
 *   spread moves at their real 75% (and at full power with one target
 *   left), damage to the partner from Earthquake and the like counted
 *   against them, and the calc's immunities (Levitate, types…).
 * - The pair: damage on the same foe adds up but stops counting at a KO,
 *   so both don't waste a turn on one KO; a foe knocked out before it moves
 *   does no damage; Protect is worth the damage it blocks (and the KO it
 *   prevents), more so while the partner gets on with knocking something
 *   out; Fake Out stops its target's move on the first turn out; Helping
 *   Hand, Follow Me, Tailwind, Trick Room, Wide Guard, sleep, burns,
 *   paralysis, setup and recovery each have a plain value.
 * - Switching: only when a Pokémon is badly threatened (it likely faints
 *   this turn, or can't touch either foe), to whoever takes the foes' moves
 *   best and fights them best.
 *
 * It always returns an explicit, legal choice built from the request.
 * Pure and isomorphic: no server or Node APIs.
 */

type CalcGen = ReturnType<typeof calcGen>;

interface SetKnowledge {
  abilities: string[];
  items: string[];
  moves: string[];
}
const RANDSETS = (randsets as unknown as { formats: Record<string, Record<string, SetKnowledge>> }).formats;
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const PROTECT = new Set(["protect", "detect", "spikyshield", "kingsshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct", "maxguard"]);
const SETUP = new Set(["swordsdance", "nastyplot", "dragondance", "calmmind", "quiverdance", "bulkup", "shellsmash", "agility", "irondefense", "coil", "victorydance", "tidyup", "shiftgear", "tailglow", "geomancy", "bellydrum", "filletaway", "growth", "workup", "honeclaws", "autotomize", "rockpolish", "noretreat", "clangoroussoul"]);
const RECOVERY = new Set(["recover", "roost", "slackoff", "softboiled", "moonlight", "synthesis", "morningsun", "shoreup", "milkdrink", "strengthsap", "rest", "junglehealing", "lunarblessing", "lifedew"]);
const SLEEP = new Set(["spore", "sleeppowder", "hypnosis", "lovelykiss", "sing", "grasswhistle", "darkvoid", "yawn"]);
const REDIRECT = new Set(["followme", "ragepowder", "spotlight"]);
const HAZARDS = new Set(["stealthrock", "spikes", "toxicspikes", "stickyweb"]);
const SPREAD = new Set(["allAdjacentFoes", "allAdjacent"]);
const FLINCH_FIRST = new Set(["fakeout"]);
const FIRST_TURN = new Set(["fakeout", "firstimpression"]);

const NEUTRAL_EVS = { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 };

/** Weights (fractions of a Pokémon's max HP are the unit). */
export const DOUBLES_TUNE = {
  /** A KO is worth this much on top of the HP taken, plus `koThreat` times the foe's own damage output. */
  ko: 0.45,
  koThreat: 0.5,
  /** Our HP lost counts this much (theirs counts 1). */
  defense: 0.85,
  /** Losing one of ours: this, plus `faintThreat` times what it would have dealt. */
  faint: 0.4,
  faintThreat: 0.35,
  /** Damage to the partner counts this much more than to a foe. */
  ally: 1.15,
  /** A switch costs this much tempo. */
  switchCost: 0.18,
  /** A Protect that blocks nothing is a wasted turn: this much. */
  protectCost: 0.14,
  /** Temperature of each foe's choice between our two Pokémon. */
  aimTemp: 0.12,
};

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

interface Dmg {
  /** Expected damage (accuracy-weighted) as a fraction of the defender's max HP, capped at its HP left. */
  d: number;
  /** Chance to KO with this hit (non-critical rolls times accuracy). */
  k: number;
}
const NO_DMG: Dmg = { d: 0, k: 0 };

interface MoveData {
  id: string;
  name: string;
  attack: boolean;
  priority: number;
  target: string;
  spread: boolean;
  type: string;
  physical: boolean;
  /** A secondary that lowers Speed (Icy Wind, Electroweb…) or flinches. */
  speedDrop: boolean;
  status?: string;
  powder: boolean;
}

const moveCache = new Map<string, MoveData>();
function moveData(battle: Battle, name: string): MoveData {
  const key = `${battle.gen}:${name}`;
  let m = moveCache.get(key);
  if (m) return m;
  const move = battle.dex.moves.get(name);
  const secondaries = (move.secondaries ?? (move.secondary ? [move.secondary] : [])) as { boosts?: Record<string, number>; chance?: number }[];
  m = {
    id: move.id || toId(name),
    name: move.exists ? move.name : name,
    attack: move.exists && move.category !== "Status",
    priority: move.priority ?? 0,
    target: move.target ?? "normal",
    spread: SPREAD.has(move.target ?? ""),
    type: move.type ?? "Normal",
    physical: move.category === "Physical",
    speedDrop: secondaries.some((s) => (s.boosts?.spe ?? 0) < 0 && (s.chance ?? 100) >= 100),
    status: typeof move.status === "string" ? move.status : undefined,
    powder: !!move.flags?.powder,
  };
  moveCache.set(key, m);
  return m;
}

const calcMoves = new Map<string, CalcMove>();
function calcMove(gen: CalcGen, name: string): CalcMove {
  const key = `${gen.num}:${name}`;
  let m = calcMoves.get(key);
  if (!m) calcMoves.set(key, (m = new CalcMove(gen, name)));
  return m;
}

/** A status move that raises its target's stats (Decorate, Coaching…): for the partner only. */
function boostsTarget(battle: Battle, id: string): boolean {
  const m = battle.dex.moves.get(id);
  return m.target !== "self" && !!m.boosts && Object.values(m.boosts as Record<string, number>).some((b) => b > 0);
}

/** Everything one decision works out once. */
interface Ctx {
  battle: Battle;
  side: Side;
  gen: CalcGen;
  level: CpuLevel;
  /** Fields for our hits on them and theirs on us, with two targets (spread moves at 75%) and with one. */
  ours: [Field, Field];
  theirs: [Field, Field];
  calcs: Map<string, Dmg>;
  mons: Map<Pokemon, CalcMon>;
  ids: WeakMap<object, number>;
  next: number;
  /** Each foe's likely moves, by Pokémon. */
  profiles: Map<Pokemon, string[]>;
  speeds: Map<Pokemon, number>;
}

const idOf = (ctx: Ctx, o: object) => {
  let id = ctx.ids.get(o);
  if (id === undefined) ctx.ids.set(o, (id = ++ctx.next));
  return id;
};

/** What a Random Doubles battle's generator gives a species, if this is one. */
function knowledge(battle: Battle, p: Pokemon): SetKnowledge | null {
  const id = String(battle.format.id ?? "");
  if (battle.gen !== 9 || !/random/.test(id)) return null;
  const sets = RANDSETS.gen9randomdoublesbattle;
  return sets?.[toId(p.species.name)] ?? sets?.[toId(p.species.baseSpecies)] ?? null;
}

/** A foe as the calc sees it: what's been shown, a neutral spread, and the ability or item when there's only one it could have. */
function foeCalc(ctx: Ctx, p: Pokemon): CalcMon {
  let mon = ctx.mons.get(p);
  if (mon) return mon;
  const { battle, gen } = ctx;
  const name = calcName(gen, p);
  const set = knowledge(battle, p);
  const own = Object.values(p.species.abilities).filter(Boolean) as string[];
  const ability = set && set.abilities.length === 1 ? set.abilities[0] : own.length === 1 ? own[0] : undefined;
  const item = p.item === "" && p.lastItem ? undefined : set && set.items.length === 1 ? set.items[0] : undefined;
  const maxHP = new CalcMon(gen, name, { level: p.level, evs: { hp: 84 } }).maxHP();
  mon = new CalcMon(gen, name, {
    level: p.level,
    nature: "Hardy",
    evs: NEUTRAL_EVS,
    ability: (gen.num >= 3 ? ability : undefined) as never,
    item: item as never,
    boosts: { ...p.boosts },
    status: (p.status || "") as never,
    curHP: Math.max(1, Math.round((p.hp / p.maxhp) * maxHP)),
    teraType: (p.terastallized || undefined) as never,
  });
  ctx.mons.set(p, mon);
  return mon;
}

/** One of ours as the calc sees it (exactly), Terastallized if `tera`. */
const ownCalc = (ctx: Ctx, p: Pokemon, tera = false) => toCalc(ctx.battle, p, false, tera);

function damage(ctx: Ctx, attacker: CalcMon, defender: CalcMon, move: string, f: Field): Dmg {
  const key = `${idOf(ctx, attacker)}:${idOf(ctx, defender)}:${idOf(ctx, f)}:${move}`;
  let out = ctx.calcs.get(key);
  if (out) return out;
  out = NO_DMG;
  try {
    const m = calcMove(ctx.gen, move);
    if (m.category !== "Status") {
      const r = calculate(ctx.gen, attacker, defender, m, f);
      const hp = Math.max(1, defender.curHP());
      const max = Math.max(1, defender.maxHP());
      const accuracy = (m as unknown as { accuracy?: number | true }).accuracy;
      const acc = typeof accuracy === "number" ? accuracy / 100 : 1;
      const [lo, hi] = r.range();
      let k: number;
      if (Array.isArray(r.damage) && typeof r.damage[0] === "number") {
        const rolls = r.damage as number[];
        k = rolls.filter((x) => x >= hp).length / rolls.length;
      } else k = lo >= hp ? 1 : hi < hp ? 0 : (hi - hp + 1) / Math.max(1, hi - lo + 1);
      out = { d: (Math.min(hp, (lo + hi) / 2) / max) * acc, k: k * acc };
    }
  } catch {
    out = NO_DMG;
  }
  ctx.calcs.set(key, out);
  return out;
}

/** The moves we expect a foe to have: shown ones first, then its Random Doubles set, else STAB guesses. */
function foeMoves(ctx: Ctx, p: Pokemon): string[] {
  let moves = ctx.profiles.get(p);
  if (moves) return moves;
  const known = p.moveSlots.filter((m) => m.used).map((m) => m.move);
  const set = knowledge(ctx.battle, p);
  if (set) moves = known.length >= 4 ? known : [...known, ...set.moves.filter((m) => !known.some((k) => toId(k) === toId(m)))];
  else {
    const physical = p.species.baseStats.atk >= p.species.baseStats.spa;
    const guesses = known.filter((m) => moveData(ctx.battle, m).attack).length >= 2 ? known : [...known, ...p.getTypes().map((t) => (STAB_GUESS[t] ?? ["Tackle", "Swift"])[physical ? 0 : 1])];
    moves = [...new Set(guesses)];
  }
  ctx.profiles.set(p, moves);
  return moves;
}

// ---------------------------------------------------------------------------
// The position
// ---------------------------------------------------------------------------

const hpOf = (p: Pokemon) => (p.maxhp ? p.hp / p.maxhp : 0);

/** A KO's smooth chance from expected damage `d` against HP left `hp` (both fractions of max HP). */
function koFrom(d: number, hp: number): number {
  if (d <= 0) return 0;
  const x = (d - hp) / (0.18 * hp + 0.04);
  return x <= -2.5 ? 0 : x >= 2.5 ? 1 : 1 / (1 + Math.exp(-2 * x));
}

/** One foe's expected attack on one of our positions. */
interface Incoming {
  /** The chance it aims this way. */
  p: number;
  d: number;
  k: number;
  priority: number;
  /** A Fake Out: the target flinches (doesn't act) if it's hit. */
  flinch: boolean;
  /** Part of a spread move (Wide Guard blocks it). */
  spread: boolean;
}

interface Foe {
  pos: number;
  p: Pokemon;
  hp: number;
  /** Our positions → the attacks expected on them. */
  on: Incoming[][];
  /** Its expected damage output this turn (on its likeliest target), for what a KO on it is worth. */
  threat: number;
  /** Chance it protects itself this turn. */
  protect: number;
  /** Its spread moves would hit (Wide Guard has a use). */
  spreads: boolean;
  physical: boolean;
  /** The priority of its likeliest attack. */
  priority: number;
}

interface Mine {
  slot: number;
  p: Pokemon;
  hp: number;
  /** What it could deal this turn at best (for what losing it costs). */
  power: number;
}

/** Action speed (paralysis, Choice Scarf, Tailwind, Trick Room…), worked out once per decision: the simulator's events are slow. */
function speedOf(ctx: Ctx, p: Pokemon): number {
  let s = ctx.speeds.get(p);
  if (s === undefined) ctx.speeds.set(p, (s = p.getActionSpeed()));
  return s;
}

/** Does `a` (at `pa` priority) move before `b` (at `pb`)? 0.5 for a speed tie. */
function before(ctx: Ctx, a: Pokemon, pa: number, b: Pokemon, pb: number): number {
  if (pa !== pb) return pa > pb ? 1 : 0;
  const sa = speedOf(ctx, a);
  const sb = speedOf(ctx, b);
  return sa === sb ? 0.5 : sa > sb ? 1 : 0;
}

function foeModel(ctx: Ctx, mine: Mine[], foes: Pokemon[]): Foe[] {
  const { battle, side } = ctx;
  const out: Foe[] = [];
  for (const p of foes) {
    const pos = side.foe.active.indexOf(p);
    const attacker = foeCalc(ctx, p);
    const moves = foeMoves(ctx, p);
    const fresh = p.activeMoveActions === 0 || p.activeTurns === 0;
    // Its best attack on each of ours (value = damage + KO), then its aim between them.
    const best: { value: number; d: number[]; k: number[]; priority: number; spread: boolean; flinch: boolean }[] = [];
    let spreads = false;
    let protects = false;
    for (const m of mine) {
      let top = { value: 0, d: mine.map(() => 0), k: mine.map(() => 0), priority: 0, spread: false, flinch: false };
      for (const name of moves) {
        const data = moveData(battle, name);
        if (PROTECT.has(data.id)) protects = true;
        if (!data.attack) continue;
        if (FIRST_TURN.has(data.id) && !fresh) continue;
        if (data.spread) spreads = true;
        const targets = data.spread ? mine : [m];
        const fieldFor = data.spread && targets.length > 1 ? ctx.theirs[0] : ctx.theirs[1];
        const d = mine.map(() => 0);
        const k = mine.map(() => 0);
        let value = 0;
        for (const t of targets) {
          const h = damage(ctx, attacker, ownCalc(ctx, t.p), name, fieldFor);
          d[mine.indexOf(t)] = h.d;
          k[mine.indexOf(t)] = h.k;
          value += h.d + 0.6 * h.k;
        }
        // Fake Out is weak but stops a move: the AI on the other side likes it on the first turn.
        if (FLINCH_FIRST.has(data.id)) value += 0.25;
        if (value > top.value) top = { value, d, k, priority: data.priority, spread: data.spread, flinch: FLINCH_FIRST.has(data.id) };
      }
      best.push(top);
    }
    const weights = best.map((b) => Math.exp(b.value / DOUBLES_TUNE.aimTemp));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const on: Incoming[][] = mine.map(() => []);
    let threat = 0;
    const likeliest = weights.indexOf(Math.max(...weights));
    best.forEach((b, i) => {
      const aim = weights[i] / total;
      if (!b.value) return;
      for (let j = 0; j < mine.length; j++) {
        if (!b.d[j] && !(b.flinch && j === i)) continue;
        on[j].push({ p: aim, d: b.d[j], k: b.k[j], priority: b.priority, flinch: b.flinch && j === i, spread: b.spread });
      }
      threat = Math.max(threat, b.d.reduce((a, x) => a + x, 0));
    });
    // Protect: likelier when it's in danger, far less right after one.
    const stall = p.volatiles.stall as { counter?: number } | undefined;
    let protect = protects ? 0.14 : 0;
    if (protects && hpOf(p) < 0.5) protect = 0.22;
    if (stall) protect *= 1 / Math.max(3, stall.counter ?? 3);
    out.push({ pos, p, hp: hpOf(p), on, threat, protect, spreads, physical: p.species.baseStats.atk > p.species.baseStats.spa, priority: best[likeliest]?.priority ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Our options
// ---------------------------------------------------------------------------

interface Opt {
  text: string;
  option: SlotOption;
  kind: "move" | "switch" | "pass";
  data?: MoveData;
  tera: boolean;
  priority: number;
  /** Damage on each foe position (by side.foe.active index). */
  on: Dmg[];
  /** Damage on the partner (Earthquake and the like). */
  ally: Dmg;
  protect: number;
  flinch: number;
  helping: boolean;
  redirect: boolean;
  wideGuard: boolean;
  /** Value of its effect beyond damage (status, field, setup, recovery…). */
  extra: number;
  /** Switch: the incoming Pokémon. */
  to?: Pokemon;
}

function speedEdge(ctx: Ctx, mine: Mine[], foes: Foe[]): number {
  // How many of the foe-vs-us speed pairings we lose.
  let lost = 0;
  let n = 0;
  for (const m of mine) for (const f of foes) {
    n++;
    if (speedOf(ctx, m.p) < speedOf(ctx, f.p)) lost++;
  }
  return n ? lost / n : 0;
}

function optionsFor(ctx: Ctx, request: BattleRequest, me: Mine, mine: Mine[], foes: Foe[]): Opt[] {
  const { battle, side } = ctx;
  const slotOptions = moveSlotOptions(request, me.slot, true);
  const partner = mine.find((m) => m.slot !== me.slot);
  const fresh = me.p.activeMoveActions === 0;
  const out: Opt[] = [];
  const foeAt = (loc: number) => foes.find((f) => f.pos === loc - 1) ?? null;
  const incomingOn = (m: Mine) => foes.reduce((a, f) => a + (f.on[mine.indexOf(m)] ?? []).reduce((b, x) => b + x.p * x.d, 0), 0);
  const threatened = incomingOn(me);
  for (const o of slotOptions) {
    if (o.kind === "pass") {
      out.push({ text: o.text, option: o, kind: "pass", tera: false, priority: 0, on: [], ally: NO_DMG, protect: 0, flinch: 0, helping: false, redirect: false, wideGuard: false, extra: 0 });
      continue;
    }
    if (o.kind === "switch") {
      out.push({ text: o.text, option: o, kind: "switch", tera: false, priority: 7, on: [], ally: NO_DMG, protect: 0, flinch: 0, helping: false, redirect: false, wideGuard: false, extra: 0, to: side.pokemon[o.index - 1] });
      continue;
    }
    if (!o.move) continue;
    const data = moveData(battle, o.move.move);
    const opt: Opt = { text: o.text, option: o, kind: "move", data, tera: o.tera, priority: data.priority, on: side.foe.active.map(() => NO_DMG), ally: NO_DMG, protect: 0, flinch: 0, helping: false, redirect: false, wideGuard: false, extra: 0 };
    if (data.attack) {
      const attacker = ownCalc(ctx, me.p, o.tera);
      const liveFoes = foes.filter((f) => alive(f.p));
      const hitsAlly = data.target === "allAdjacent" && partner && alive(partner.p);
      const n = data.spread ? liveFoes.length + (hitsAlly ? 1 : 0) : 1;
      const f = n > 1 ? ctx.ours[0] : ctx.ours[1];
      if (FIRST_TURN.has(data.id) && !fresh) {
        opt.extra -= 1; // it would fail
      } else if (data.spread) {
        for (const foe of liveFoes) opt.on[foe.pos] = damage(ctx, attacker, foeCalc(ctx, foe.p), o.move.move, f);
        if (hitsAlly) opt.ally = damage(ctx, attacker, ownCalc(ctx, partner!.p), o.move.move, f);
      } else {
        // Aimed at a foe that's gone: the move goes to the other one (Gen 5 on).
        const foe = foeAt(o.target) ?? (battle.gen >= 5 ? liveFoes[0] : null);
        if (foe) opt.on[foe.pos] = damage(ctx, attacker, foeCalc(ctx, foe.p), o.move.move, f);
        if (foe && FLINCH_FIRST.has(data.id) && opt.on[foe.pos].d > 0 && fresh) opt.flinch = foe.pos + 1;
      }
      // Icy Wind, Electroweb: speed control is worth more when they're faster.
      if (data.speedDrop) opt.extra += 0.06 * liveFoes.length * speedEdge(ctx, mine, foes);
    } else {
      const id = data.id;
      const target = o.target > 0 ? foeAt(o.target) : null;
      const foeSide = side.foe;
      if (PROTECT.has(id)) {
        const stall = me.p.volatiles.stall as { counter?: number } | undefined;
        opt.protect = stall ? 1 / Math.max(3, stall.counter ?? 3) : 1;
        opt.extra -= DOUBLES_TUNE.protectCost;
      } else if (id === "helpinghand") opt.helping = !!partner && alive(partner.p);
      else if (REDIRECT.has(id)) opt.redirect = true;
      else if (id === "wideguard") opt.wideGuard = foes.some((f) => f.spreads) && !side.sideConditions.wideguard;
      else if (id === "tailwind") opt.extra += side.sideConditions.tailwind ? -0.4 : 0.12 + 0.35 * speedEdge(ctx, mine, foes);
      else if (id === "trickroom") {
        const edge = speedEdge(ctx, mine, foes);
        opt.extra += battle.field.pseudoWeather.trickroom ? (edge > 0.5 ? -0.5 : 0.3 - 0.4 * edge) : 0.4 * edge - 0.18;
      } else if (SLEEP.has(id) && target) {
        const t = target.p;
        const sleeping = foeSide.pokemon.some((q) => q.status === "slp" && !q.fainted);
        const immune = !!t.status || (data.powder && (t.hasType("Grass") || toId(t.getAbility().name) === "overcoat")) || t.volatiles.substitute || battle.field.terrain === "electricterrain" || battle.field.terrain === "mistyterrain";
        opt.extra += immune || sleeping ? -0.3 : 0.15 + 0.5 * target.threat;
      } else if (data.status && target) {
        const t = target.p;
        const st = data.status;
        const immune = !!t.status || (st === "brn" && t.hasType("Fire")) || (st === "par" && (t.hasType("Electric") || (id === "thunderwave" && t.hasType("Ground")))) || ((st === "psn" || st === "tox") && (t.hasType("Poison") || t.hasType("Steel")));
        const useful = st === "brn" ? (target.physical ? 0.3 : 0.08) : st === "par" ? (before(ctx, t, 0, me.p, 0) ? 0.22 : 0.08) : 0.12;
        opt.extra += immune ? -0.3 : useful * (0.5 + target.threat);
      } else if (SETUP.has(id)) {
        const safe = threatened < 0.35 && me.hp > 0.6;
        opt.extra += safe ? 0.22 : -0.25;
      } else if (RECOVERY.has(id)) {
        opt.extra += me.hp < 0.55 && threatened < 0.5 ? 0.5 * (1 - me.hp) : -0.25;
      } else if (HAZARDS.has(id)) {
        opt.extra += foeSide.sideConditions[id] ? -0.3 : Math.max(0, foeSide.pokemonLeft - 2) * 0.03;
      } else if (id === "encore" && target) {
        const last = target.p.lastMove;
        opt.extra += last && (last.category === "Status" || PROTECT.has(last.id)) ? 0.2 : 0.01;
      } else if (id === "taunt" && target) opt.extra += 0.04;
      else if (target && boostsTarget(battle, id)) opt.extra -= 0.5; // Decorate and the like: never on a foe
      else opt.extra += 0.01;
    }
    out.push(opt);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring a pair of choices
// ---------------------------------------------------------------------------

/** The value of our two choices together (one per position; a lone Pokémon scores alone). */
function scorePair(ctx: Ctx, mine: Mine[], foes: Foe[], opts: Opt[]): number {
  const T = DOUBLES_TUNE;
  // Switching: the incoming Pokémon takes the hits meant for the one leaving.
  const holders = mine.map((m, i) => (opts[i].kind === "switch" && opts[i].to ? opts[i].to! : m.p));
  const hpAt = holders.map((p, i) => (opts[i].kind === "switch" ? hpOf(p) : mine[i].hp));

  // Follow Me: single-target attacks meant for the partner come to the redirector.
  const redirector = opts.findIndex((o) => o.redirect);

  // The foes' attacks on each of our positions, after redirection and switches.
  const attacks = mine.map(() => [] as { foe: Foe; a: Incoming }[]);
  for (const f of foes) {
    mine.forEach((m, i) => {
      for (const a of f.on[i] ?? []) {
        let to = i;
        if (redirector >= 0 && redirector !== i && !a.spread && !a.flinch) to = redirector;
        let inc = a;
        if (opts[to].kind === "switch" && opts[to].to) inc = switchedHit(ctx, f, a, opts[to].to!, mine.length > 1);
        else if (to !== i) inc = { ...a, ...redirectedHit(ctx, f, a, mine[to]) };
        attacks[to].push({ foe: f, a: inc });
      }
    });
  }

  // Fake Out from us: the foe it hits doesn't act.
  const flinched = foes.map((f) => {
    let p = 0;
    opts.forEach((o) => {
      if (o.flinch === f.pos + 1) p = Math.max(p, 1 - f.protect);
    });
    return p;
  });

  // Pass 1: our chance to KO each foe before it moves (assuming we act).
  const koBefore = (act: number[]) =>
    foes.map((f) => {
      let miss = 1;
      let d = 0;
      opts.forEach((o, i) => {
        if (o.kind !== "move" || !o.data?.attack) return;
        const h = o.on[f.pos];
        if (!h || !h.d) return;
        const first = before(ctx, mine[i].p, o.priority, f.p, f.priority);
        miss *= 1 - act[i] * first * h.k;
        d += act[i] * first * h.d;
      });
      return (1 - f.protect) * Math.max(1 - miss, koFrom(d, f.hp));
    });

  const actChance = (ko: number[]) =>
    mine.map((m, i) => {
      const o = opts[i];
      if (o.kind !== "move") return 0;
      let dmg = 0;
      let flinch = 0;
      for (const { foe, a } of attacks[i]) {
        const live = (1 - ko[foes.indexOf(foe)]) * (1 - flinched[foes.indexOf(foe)]) * (1 - foe.protect);
        const first = before(ctx, foe.p, a.priority, m.p, o.priority);
        if (a.flinch) flinch = Math.max(flinch, a.p * live * first);
        else dmg += a.p * live * first * a.d;
      }
      return (1 - flinch) * (1 - koFrom(dmg, m.hp));
    });

  let ko = koBefore(mine.map(() => 1));
  const act = actChance(ko);
  ko = koBefore(act);

  let score = 0;
  // Offense: per foe, damage adds up but stops at its HP; a KO adds its worth.
  for (const f of foes) {
    let d = 0;
    let miss = 1;
    opts.forEach((o, i) => {
      if (o.kind !== "move" || !o.data?.attack) return;
      const h = o.on[f.pos];
      if (!h || !h.d) return;
      const boost = opts.some((p, j) => j !== i && p.helping) ? 1.5 : 1;
      d += act[i] * h.d * boost;
      miss *= 1 - act[i] * Math.min(1, h.k * (boost > 1 ? 1.6 : 1));
    });
    if (!d) continue;
    const k = Math.max(1 - miss, koFrom(d, f.hp));
    score += (1 - f.protect) * (Math.min(d, f.hp) + k * (T.ko + T.koThreat * f.threat));
  }

  // Defense: what we expect to lose, and the chance each of ours faints.
  mine.forEach((m, i) => {
    const o = opts[i];
    const shield = o.protect;
    let dmg = 0;
    let kMiss = 1;
    for (const { foe, a } of attacks[i]) {
      if (a.flinch && !a.d) continue;
      const idx = foes.indexOf(foe);
      // A foe knocked out before it moves, or flinched, deals nothing.
      const first = before(ctx, foe.p, a.priority, holders[i], o.priority);
      const live = (1 - foe.protect) * (1 - flinched[idx]) * (1 - ko[idx] * (1 - first));
      const blocked = Math.max(shield, opts.some((p) => p.wideGuard) && a.spread ? 1 : 0);
      dmg += a.p * live * (1 - blocked) * a.d;
      kMiss *= 1 - a.p * live * (1 - blocked) * a.k;
    }
    // The partner's Earthquake.
    opts.forEach((p, j) => {
      if (j === i || p.kind !== "move" || !p.ally.d) return;
      const w = act[j] * (1 - shield) * T.ally;
      dmg += w * p.ally.d;
      kMiss *= 1 - w * p.ally.k;
    });
    const hp = hpAt[i];
    const faint = Math.max(1 - kMiss, koFrom(dmg, hp));
    const worth = o.kind === "switch" ? 0.5 * T.faintThreat + T.faint : T.faint + T.faintThreat * m.power;
    score -= T.defense * Math.min(dmg, hp) + faint * worth;
  });

  // Protect is better spent while the partner gets something done.
  opts.forEach((o, i) => {
    score += o.extra;
    if (o.protect) {
      const partnerKo = ko.some((k) => k > 0.5) && opts.some((p, j) => j !== i && p.kind === "move" && p.data?.attack);
      if (partnerKo) score += 0.05;
    }
    if (o.helping) {
      const partner = opts.find((p, j) => j !== i && p.kind === "move" && p.data?.attack);
      if (!partner) score -= 0.2;
    }
    if (o.kind === "switch") {
      // Coming straight back out of a switch just made is rarely right.
      const settled = mine[i].p.activeTurns > 1 ? 0 : 0.12;
      score -= T.switchCost + settled + switchValue(ctx, mine[i], o.to!, foes);
    }
  });
  return score;
}

/** A foe's attack, landing on a Pokémon switching in instead. */
function switchedHit(ctx: Ctx, f: Foe, a: Incoming, to: Pokemon, two: boolean): Incoming {
  if (a.flinch) return { ...a, flinch: false, d: 0, k: 0 };
  const attacker = foeCalc(ctx, f.p);
  let best = { d: 0, k: 0 };
  for (const name of foeMoves(ctx, f.p)) {
    const data = moveData(ctx.battle, name);
    if (!data.attack || data.priority !== a.priority || data.spread !== a.spread) continue;
    const h = damage(ctx, attacker, ownCalc(ctx, to), name, a.spread && two ? ctx.theirs[0] : ctx.theirs[1]);
    // The move it picked was its best on the one leaving: take the one that hits the newcomer hardest of those like it, at a discount.
    if (h.d > best.d) best = h;
  }
  return { ...a, d: best.d * 0.85, k: best.k * 0.85 };
}

/** A foe's single-target attack, drawn to another of ours by Follow Me. */
function redirectedHit(ctx: Ctx, f: Foe, a: Incoming, to: Mine): { d: number; k: number } {
  const attacker = foeCalc(ctx, f.p);
  let best = { d: 0, k: 0 };
  for (const name of foeMoves(ctx, f.p)) {
    const data = moveData(ctx.battle, name);
    if (!data.attack || data.spread || data.priority !== a.priority) continue;
    const h = damage(ctx, attacker, ownCalc(ctx, to.p), name, ctx.theirs[1]);
    if (h.d > best.d) best = h;
  }
  return best;
}

/** How much better (positive) the Pokémon now in battle fights the foes than `to` would, from here on. */
function switchValue(ctx: Ctx, from: Mine, to: Pokemon, foes: Foe[]): number {
  return matchup(ctx, from.p, foes.map((f) => f.p)) - matchup(ctx, to, foes.map((f) => f.p));
}

/** How a Pokémon of ours fares against these foes: its best hit on each, minus theirs on it, plus a little for its HP. */
function matchup(ctx: Ctx, p: Pokemon, foes: Pokemon[]): number {
  if (!foes.length) return hpOf(p);
  const mine = ownCalc(ctx, p);
  let total = 0;
  for (const foe of foes) {
    const theirs = foeCalc(ctx, foe);
    let out = 0;
    for (const slot of p.moveSlots) {
      const h = damage(ctx, mine, theirs, slot.move, ctx.ours[1]);
      out = Math.max(out, h.d + 0.4 * h.k);
    }
    let inc = 0;
    for (const name of foeMoves(ctx, foe)) {
      if (!moveData(ctx.battle, name).attack) continue;
      const h = damage(ctx, theirs, mine, name, ctx.theirs[1]);
      inc = Math.max(inc, h.d + 0.4 * h.k);
    }
    const speed = speedOf(ctx, p) > speedOf(ctx, foe) ? 0.1 : 0;
    total += out - 1.1 * inc + speed;
  }
  return total / foes.length + 0.2 * hpOf(p);
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

const NOISE: Record<CpuLevel, number> = { easy: 0.4, normal: 0.08, hard: 0 };
/** Options per position kept for pairing (the best by their own score), so a turn's pairs stay few. */
const KEEP = 9;

function makeCtx(battle: Battle, side: Side, level: CpuLevel): Ctx {
  return {
    battle,
    side,
    gen: calcGen(battle),
    level,
    ours: [field(battle, true, side), field(battle, false, side)],
    theirs: [field(battle, true, side.foe), field(battle, false, side.foe)],
    calcs: new Map(),
    mons: new Map(),
    ids: new WeakMap(),
    next: 0,
    profiles: new Map(),
    speeds: new Map(),
  };
}

/** The computer's choice for `side` in a double battle. */
export function chooseCpuDoubles(
  battle: Battle,
  side: Side,
  level: CpuLevel,
  rand: () => number,
  onError: (err: unknown) => void = (err) => console.error("[battle] doubles cpu fell back to a random choice:", err)
): string {
  const request = side.activeRequest as unknown as BattleRequest | null;
  if (!request || request.wait) throw new Error("The computer has nothing to choose.");
  try {
    return withCalcMemo(() => decide(makeCtx(battle, side, level), request, rand));
  } catch (err) {
    onError(err);
    return randomChoice(request, true, rand);
  }
}

function decide(ctx: Ctx, request: BattleRequest, rand: () => number): string {
  const { side } = ctx;
  const noise = NOISE[ctx.level];
  const jitter = () => (noise ? (rand() - 0.5) * noise : 0);
  const foesNow = side.foe.active.filter(alive);

  if (request.teamPreview) {
    // Lead with the two that fare best against their whole team.
    const theirs = side.foe.pokemon.filter((p) => !p.fainted);
    const ranked = side.pokemon.map((p, i) => ({ i: i + 1, s: matchup(ctx, p, theirs) + jitter() })).sort((a, b) => b.s - a.s);
    const order = [...ranked.slice(0, 2).map((r) => r.i), ...side.pokemon.map((_, i) => i + 1).filter((i) => !ranked.slice(0, 2).some((r) => r.i === i))];
    return `team ${order.join("")}`;
  }

  if (request.forceSwitch) {
    const taken = new Set<number>();
    return forcedSwitchSlots(request)
      .map(({ pool, reviving }) => {
        const free = pool.filter((i) => !taken.has(i));
        if (!free.length) return "pass";
        let pick = free[0];
        if (!reviving && foesNow.length) {
          let best = -Infinity;
          for (const i of free) {
            const s = matchup(ctx, side.pokemon[i - 1], foesNow) + jitter();
            if (s > best) [pick, best] = [i, s];
          }
        }
        taken.add(pick);
        return `switch ${pick}`;
      })
      .join(", ");
  }

  const slots = request.active?.length ?? 0;
  const mine: Mine[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const p = side.active[slot];
    const options = moveSlotOptions(request, slot, true);
    if (!alive(p) || (options.length === 1 && options[0].kind === "pass")) continue;
    mine.push({ slot, p, hp: hpOf(p), power: 0 });
  }
  if (!mine.length || !foesNow.length) return randomChoice(request, true, () => 0);

  const foes = foeModel(ctx, mine, foesNow);
  const perSlot = mine.map((m) => optionsFor(ctx, request, m, mine, foes));
  // What each of ours could deal at best (losing a hard hitter costs more).
  mine.forEach((m, i) => {
    m.power = Math.max(0, ...perSlot[i].map((o) => o.on.reduce((a, h) => a + (h?.d ?? 0), 0)));
  });

  // Switching is for a Pokémon in real trouble: likely to faint this turn and unable to KO first, or unable to touch either foe.
  const filtered = perSlot.map((list, i) => {
    const m = mine[i];
    let incoming = 0;
    let kMiss = 1;
    for (const f of foes) for (const a of f.on[i] ?? []) {
      incoming += a.p * a.d;
      kMiss *= 1 - a.p * a.k;
    }
    const doomed = Math.max(1 - kMiss, koFrom(incoming, m.hp)) >= 0.55;
    const canKoFirst = list.some((o) => o.data?.attack && foes.some((f) => (o.on[f.pos]?.k ?? 0) >= 0.5 && before(ctx, m.p, o.priority, f.p, 0) === 1));
    const helpless = m.power < 0.12 && !list.some((o) => o.kind === "move" && !o.data?.attack && o.extra > 0.1);
    const trouble = (doomed && !canKoFirst) || helpless;
    const keep = list.filter((o) => o.kind !== "switch" || trouble);
    return keep.length ? keep : list;
  });

  // Each option alone (the partner idle), to keep the best few for pairing.
  const pass: Opt = { text: "pass", option: { kind: "pass", text: "pass", index: 0, target: 0, tera: false }, kind: "pass", tera: false, priority: 0, on: [], ally: NO_DMG, protect: 0, flinch: 0, helping: false, redirect: false, wideGuard: false, extra: 0 };
  const shortlists = filtered.map((list, i) => {
    const scored = list.map((o) => {
      const pairOpts = mine.map((_, j) => (j === i ? o : pass));
      return { o, s: scorePair(ctx, mine, foes, pairOpts) };
    });
    scored.sort((a, b) => b.s - a.s);
    // Tera only where it's worth something over the same move without it.
    const plain = new Map(scored.filter((x) => !x.o.tera).map((x) => [x.o.text, x.s]));
    const kept = scored.filter((x) => !x.o.tera || x.s > (plain.get(x.o.text.replace(/ terastallize$/, "")) ?? -Infinity) + 0.12);
    return kept.slice(0, KEEP).map((x) => x.o);
  });

  let bestScore = -Infinity;
  let chosen: Opt[] | null = null;
  const consider = (opts: Opt[]) => {
    const switches = opts.filter((o) => o.kind === "switch").map((o) => o.option.index);
    if (new Set(switches).size !== switches.length) return;
    const teras = opts.filter((o) => o.tera).length;
    if (teras > 1) return;
    // Terastallizing is once a battle: it has to buy something.
    const score = scorePair(ctx, mine, foes, opts) + jitter() - (teras ? 0.02 : 0);
    if (score > bestScore) [bestScore, chosen] = [score, opts];
  };
  if (mine.length === 1) for (const o of shortlists[0]) consider([o]);
  else for (const a of shortlists[0]) for (const b of shortlists[1]) consider([a, b]);

  // TypeScript can't see the assignment inside consider().
  const picked = chosen as Opt[] | null;
  // The choice text, position by position (a position with no Pokémon passes).
  const parts: string[] = [];
  let megaDone = false;
  for (let slot = 0; slot < slots; slot++) {
    const i = mine.findIndex((m) => m.slot === slot);
    let text: string;
    if (i < 0 || !picked) {
      const options = moveSlotOptions(request, slot, true);
      text = (options.find((o) => o.kind === "move" && !o.tera) ?? options.find((o) => o.kind !== "switch") ?? options[0]).text;
      if (text.startsWith("switch")) {
        const used = parts.map((p) => /^switch (\d+)/.exec(p)?.[1]).filter(Boolean).map(Number);
        const free = benchIndices(request).find((x) => !used.includes(x));
        text = free ? `switch ${free}` : "pass";
      }
    } else text = picked[i].text;
    const active = request.active?.[slot] as { canMegaEvo?: boolean } | undefined;
    if (!megaDone && ctx.level !== "easy" && text.startsWith("move ") && active?.canMegaEvo) {
      text += " mega";
      megaDone = true;
    }
    parts.push(text);
  }
  return parts.join(", ");
}
