import { Battle, type Pokemon } from "@pkmn/client";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import { Protocol } from "@pkmn/protocol";
import {
  addChance,
  addRoll,
  critChance,
  critStage,
  emptyRolls,
  emptyTally,
  hitChance,
  luckScore,
  NO_CRIT_MOVES,
  statusImmune,
  type LuckTally,
  type RollTally,
} from "./luck-math";
import type { MonState } from "./parse";
import { STATS_VERSION, type BattleStats, type IndirectKind, type LuckEvent, type MonStats, type SideLuck, type StatsSide, type TurnNote } from "./stats-types";

/**
 * A battle's stats from its replay log (the spectator channel), line by line
 * with @pkmn/client tracking the state: who dealt and took how much damage
 * (and how: hazards, weather, status, recoil, Life Orb), KOs, healing, turns
 * in battle; every crit, miss and secondary effect against the odds it had;
 * and what happened in each turn, for the turning points. Every count comes
 * from a line in the log; the odds come from the move data and what the
 * battle had revealed (an item or ability counts once it's shown, or when
 * the assumed set gives it).
 *
 * Damage rolls need the damage calc and the sets, which this file doesn't
 * load: the caller passes `placeRoll`, which places a hit in its range.
 */

const gens = new Generations(Dex);
const toId = (s: string | undefined | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A hit whose damage roll might be placed: the state just before it. */
export interface RollCandidate {
  gen: number;
  move: string;
  attacker: MonState;
  defender: MonState;
  attackerConditions: Record<string, number>;
  defenderConditions: Record<string, number>;
  weather: string;
  terrain: string;
  /** The defender's HP bar before and after the hit (percent). */
  before: number;
  after: number;
}

export interface StatsOptions {
  /** What the assumed sets say about each Pokémon (by key), used where the battle didn't show it. */
  hints?: Map<string, { ability?: string; item?: string }>;
  /** Places a hit in its damage range: 0 lowest roll to 1 highest, or null if it can't. */
  placeRoll?: (c: RollCandidate) => number | null;
  /** Max HP per Pokémon (by key), when known. */
  maxHp?: (key: string) => number | null;
}

const SEMI_INVULNERABLE = new Set(["fly", "bounce", "dig", "dive", "phantomforce", "shadowforce", "skydrop"]);
const PROTECTS = new Set(["protect", "detect", "kingsshield", "spikyshield", "banefulbunker", "obstruct", "silktrap", "burningbulwark", "maxguard", "matblock", "quickguard", "wideguard", "craftyshield"]);
const HAZARDS = new Set(["stealthrock", "spikes", "toxicspikes", "stickyweb", "gmaxsteelsurge"]);
const STATUS_DAMAGE = new Set(["psn", "tox", "brn"]);
const WEATHER_DAMAGE = new Set(["sandstorm", "hail"]);
const STATUS_NAMES: Record<string, string> = { brn: "burned", par: "paralyzed", psn: "poisoned", tox: "badly poisoned", slp: "put to sleep", frz: "frozen" };
const STAT_NAMES: Record<string, string> = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" };

const sideOf = (ident: string | undefined): StatsSide | null => (ident?.startsWith("p1") ? 0 : ident?.startsWith("p2") ? 1 : null);
const pctOf = (p: Pokemon) => (p.maxhp ? (100 * p.hp) / p.maxhp : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const spriteOf = (species: string) => {
  const s = Dex.species.get(species);
  return s.exists ? { id: s.id, num: s.num } : null;
};
const percent = (p: number) => `${p >= 0.995 ? 100 : p < 0.01 ? (Math.round(p * 1000) / 10).toFixed(1) : Math.round(p * 100)}%`;

function snapshot(p: Pokemon): MonState {
  return {
    key: p.originalIdent,
    species: p.speciesForme,
    level: p.level || 100,
    hp: p.fainted ? 0 : p.maxhp ? Math.max(1, Math.round((100 * p.hp) / p.maxhp)) : 100,
    fainted: p.fainted || p.hp <= 0,
    status: p.status ?? "",
    boosts: Object.fromEntries(Object.entries(p.boosts).filter(([, v]) => v)) as Record<string, number>,
    terastallized: p.terastallized ?? "",
    item: p.item ? Dex.items.get(p.item).name : p.lastItem || p.itemEffect ? "" : null,
  };
}

function conditionsOf(b: Battle, side: StatsSide): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, c] of Object.entries((side === 0 ? b.p1 : b.p2).sideConditions)) out[id] = c.level || 1;
  return out;
}

interface HitRecord {
  target: string;
  /** Secondary chances on this hit, still to be settled. */
  secondaries: { kind: "status" | "flinch" | "confusion" | "drop" | "raise"; p: number; status?: string; stats?: string[] }[];
  survived: boolean;
}

/** A move being used: everything that follows it until the next move or turn belongs to it. */
interface MoveCtx {
  user: string;
  side: StatsSide;
  species: string;
  move: ReturnType<typeof Dex.moves.get>;
  turn: number;
  /** Targets with an accuracy roll pending: key → chance to hit. */
  accuracy: Map<string, number>;
  missed: Set<string>;
  /** Targets the move never rolled against (protected, immune, failed). */
  void: Set<string>;
  crit: Set<string>;
  hits: HitRecord[];
  /** Effects seen on targets: key → kinds. */
  seen: { status: Map<string, string>; flinchable: Map<string, number>; confusion: Set<string>; drops: Map<string, Set<string>>; raises: Set<string> };
  serene: boolean;
}

export function computeStats(log: readonly string[], opts: StatsOptions = {}): BattleStats {
  const battle = new Battle(gens);
  const mons = new Map<string, MonStats>();
  const luck: [Tallies, Tallies] = [newTallies(), newTallies()];
  const luckEvents: LuckEvent[] = [];
  const notes: TurnNote[][] = [[]];
  const leads: [string | null, string | null] = [null, null];
  const rollsCount = { placed: 0, unplaced: 0 };
  let turn = 0;
  let winner: StatsSide | null = null;
  const players: [string, string] = ["Player 1", "Player 2"];
  let ctx: MoveCtx | null = null;
  /** Who last hurt each Pokémon, for the KO. */
  const lastHurt = new Map<string, { by: string | null; how: string | null }>();
  const statusBy = new Map<string, string | null>();
  const hazardBy: [Map<string, string>, Map<string, string>] = [new Map(), new Map()];
  let weatherBy: string | null = null;
  const charging = new Set<string>();
  /** The Pokémon that switched in last (its arrival's effects: Toxic Spikes, hazards). */
  let justIn: string | null = null;
  /** Past the end-of-turn effects: a switch now replaces a fainted Pokémon, it isn't a choice. */
  let afterUpkeep = false;
  /** Pokémon in battle at some point this turn (each counts the turn once). */
  const onField = new Set<string>();
  /** Foes that can still flinch this turn: key → { by, p }. */
  const flinchWatch = new Map<string, { by: string; side: StatsSide; move: string; p: number; target: string }>();

  const stat = (p: Pokemon): MonStats => {
    const key = p.originalIdent;
    let m = mons.get(key);
    if (!m) {
      m = { key, side: sideOf(key) ?? 0, species: p.speciesForme, sprite: spriteOf(p.speciesForme), dealt: 0, dealtHp: 0, dealtIndirect: 0, taken: 0, takenIndirect: {}, healed: 0, kos: 0, fainted: false, koBy: null, turns: 0, hits: 0, maxHp: opts.maxHp?.(key) ?? null };
      mons.set(key, m);
    }
    return m;
  };
  const speciesOf = (key: string | null | undefined) => (key ? (mons.get(key)?.species ?? key.replace(/^p[12]: /, "")) : "");
  const note = (n: TurnNote) => (notes[turn] ??= []).push(n);
  const abilityOf = (p: Pokemon) => toId(p.ability || p.baseAbility) || toId(opts.hints?.get(p.originalIdent)?.ability);
  const itemOf = (p: Pokemon) => (p.item ? toId(p.item) : p.lastItem || p.itemEffect ? "" : toId(opts.hints?.get(p.originalIdent)?.item));
  const get = (ident: string | undefined) => (ident ? battle.getPokemon(ident as never) : null);
  /** A Pokémon by its key ("p1: Name"), in battle or not. */
  const byKey = (key: string) => [...battle.p1.team, ...battle.p2.team].find((x) => x.originalIdent === key) ?? null;

  function settleMove() {
    const c = ctx;
    ctx = null;
    if (!c) return;
    const foe: StatsSide = c.side === 0 ? 1 : 0;
    // Accuracy.
    for (const [target, p] of c.accuracy) {
      if (c.void.has(target)) continue;
      const missed = c.missed.has(target);
      addChance(luck[c.side].missesOwn, 1 - p, missed);
      addChance(luck[foe].missesFoe, 1 - p, missed);
      if (missed) {
        luckEvents.push({ turn: c.turn, side: foe, kind: "miss", text: `${c.species}'s ${c.move.name} missed ${speciesOf(target)}`, chance: 1 - p });
        note({ kind: "miss", side: c.side, mon: c.species, target: speciesOf(target), move: c.move.name, chance: 1 - p });
      }
    }
    // Secondary effects: one chance per eligible hit, each seen effect used once.
    const statusLeft = new Map(c.seen.status);
    const confusionLeft = new Set(c.seen.confusion);
    const dropsLeft = new Map([...c.seen.drops].map(([k, v]) => [k, new Set(v)]));
    let raiseLeft = c.seen.raises.size > 0;
    for (const hit of c.hits) {
      for (const s of hit.secondaries) {
        let happened = false;
        if (s.kind === "status") {
          happened = statusLeft.get(hit.target) === s.status;
          if (happened) statusLeft.delete(hit.target);
        } else if (s.kind === "confusion") {
          happened = confusionLeft.delete(hit.target);
        } else if (s.kind === "drop") {
          const d = dropsLeft.get(hit.target);
          happened = !!d && (s.stats ?? []).some((st) => d.has(st));
          if (happened) dropsLeft.delete(hit.target);
        } else if (s.kind === "raise") {
          happened = raiseLeft;
          raiseLeft = false;
        } else if (s.kind === "flinch") {
          continue; // settled when the target would have moved (flinchWatch)
        }
        addChance(luck[c.side].procsLanded, s.p, happened);
        addChance(luck[foe].procsReceived, s.p, happened);
        if (happened) {
          const what =
            s.kind === "status"
              ? `${STATUS_NAMES[s.status ?? ""] ?? "statused"} ${speciesOf(hit.target)}`
              : s.kind === "confusion"
                ? `confused ${speciesOf(hit.target)}`
                : s.kind === "drop"
                  ? `lowered ${speciesOf(hit.target)}'s ${(s.stats ?? []).map((x) => STAT_NAMES[x] ?? x).join(" and ")}`
                  : `raised ${c.species}'s ${(s.stats ?? []).map((x) => STAT_NAMES[x] ?? x).join(" and ")}`;
          luckEvents.push({ turn: c.turn, side: c.side, kind: "proc", text: `${c.species}'s ${c.move.name} ${what}`, chance: s.p });
          note({ kind: s.kind === "status" ? "status" : "proc", side: c.side, mon: c.species, target: speciesOf(hit.target), move: c.move.name, chance: s.p, detail: s.kind === "status" ? s.status : what });
        }
      }
    }
  }

  function damage(target: Pokemon, before: number, kwArgs: Record<string, unknown>) {
    const after = pctOf(target);
    const lost = Math.max(0, before - after);
    const t = stat(target);
    const from = toId(String(kwArgs.from ?? "").replace(/^(item|ability|move):\s*/i, ""));
    const fromRaw = String(kwArgs.from ?? "");
    const of = get(kwArgs.of as string | undefined);
    const tSide = t.side;
    if (!kwArgs.from) {
      if (ctx && sideOf(ctx.user) !== tSide) {
        // A foe's move.
        const by = mons.get(ctx.user);
        t.taken += lost;
        if (by) {
          by.dealt += lost;
          by.dealtHp = by.dealtHp === null || t.maxHp === null ? null : by.dealtHp + (lost * t.maxHp) / 100;
          by.hits += 1;
        }
        lastHurt.set(t.key, { by: ctx.user, how: null });
        return lost;
      }
      // Its own move (Substitute, Belly Drum, Curse…), or nothing to pin it on.
      add(t.takenIndirect, "other", lost);
      lastHurt.set(t.key, { by: null, how: ctx?.move.name ?? null });
      return lost;
    }
    let kind: IndirectKind = "other";
    let credit: string | null = of && of.originalIdent !== t.key ? of.originalIdent : null;
    let how = fromRaw.replace(/^(item|ability|move):\s*/i, "");
    if (HAZARDS.has(from)) {
      kind = "hazard";
      credit = hazardBy[tSide].get(from) ?? null;
    } else if (STATUS_DAMAGE.has(from)) {
      kind = "status";
      credit = statusBy.get(t.key) ?? null;
      how = from === "brn" ? "burn" : "poison";
    } else if (WEATHER_DAMAGE.has(from)) {
      kind = "weather";
      credit = weatherBy;
      how = from === "sandstorm" ? "Sandstorm" : "Hail";
    } else if (from === "recoil" || from === "mindblown" || from === "steelbeam" || from === "chloroblast") {
      kind = "recoil";
      credit = null;
      how = "recoil";
    } else if (from === "lifeorb") {
      kind = "lifeorb";
      credit = null;
    } else if (from === "confusion") {
      credit = null;
      how = "confusion";
    }
    if (credit && sideOf(credit) === tSide) credit = null;
    add(t.takenIndirect, kind, lost);
    if (credit) {
      const c = mons.get(credit);
      if (c) c.dealtIndirect += lost;
    }
    lastHurt.set(t.key, { by: credit, how });
    return lost;
  }

  for (const line of log) {
    let parsed: { args: readonly string[]; kwArgs: Record<string, unknown> };
    try {
      parsed = Protocol.parseBattleLine(line) as unknown as typeof parsed;
    } catch {
      continue;
    }
    const { args, kwArgs } = parsed;
    const cmd = args[0];
    const switching = cmd === "switch" || cmd === "drag" || cmd === "replace";
    const ident = /^p[12][a-d]?: /.test(args[1] ?? "") ? args[1] : undefined;
    // A switch line names the Pokémon coming in: look it up on the bench (by its key), not in the slot.
    const p = !ident ? null : switching ? get(ident.replace(/^(p[12])[a-d]?: /, "$1: ")) : get(ident);
    const hpBefore = p ? pctOf(p) : 0;

    // Before the tracker reads the line.
    if (cmd === "move") {
      settleMove();
      const user = p;
      if (user) {
        charging.delete(user.originalIdent);
        const side = sideOf(args[1])!;
        const move = Dex.moves.get(args[2] ?? "");
        const target = get(args[3]);
        ctx = {
          user: user.originalIdent,
          side,
          species: stat(user).species,
          move,
          turn,
          accuracy: new Map(),
          missed: new Set(),
          void: new Set(),
          crit: new Set(),
          hits: [],
          seen: { status: new Map(), flinchable: new Map(), confusion: new Set(), drops: new Map(), raises: new Set() },
          serene: abilityOf(user) === "serenegrace",
        };
        if (turn > 0) note({ kind: "move", side, mon: ctx.species, move: move.name || args[2], target: target && sideOf(args[3]) !== side ? stat(target).species : undefined });
        // The accuracy roll, against a foe that isn't out of reach.
        if (target && sideOf(args[3]) !== side && move.exists && !kwArgs.still && !kwArgs.notarget && !charging.has(target.originalIdent)) {
          const chance = hitChance({
            gen: battle.gen.num,
            move: { id: move.id, accuracy: move.accuracy, ohko: move.ohko, category: move.category, type: move.type },
            user: { level: user.level || 100, types: user.types, ability: abilityOf(user), item: itemOf(user), accuracy: user.boosts.accuracy ?? 0, confused: !!user.volatiles.confusion },
            target: { level: target.level || 100, types: target.types, ability: abilityOf(target), item: itemOf(target), evasion: target.boosts.evasion ?? 0, confused: !!target.volatiles.confusion },
            weather: toId(battle.field.weather),
            gravity: !!battle.field.pseudoWeather.gravity,
            targetMoved: !!target.moveThisTurn,
          });
          if (chance !== null && chance < 1) ctx.accuracy.set(target.originalIdent, chance);
        }
        if (kwArgs.miss && target) ctx.missed.add(target.originalIdent);
      }
    } else if (cmd === "upkeep") {
      settleMove();
      afterUpkeep = true;
    } else if (cmd === "turn") {
      settleMove();
      // A foe that never got to move again (it fainted, or the turn ended) had no flinch to roll.
      flinchWatch.clear();
      afterUpkeep = false;
    } else if (cmd === "-prepare" && p && SEMI_INVULNERABLE.has(toId(args[2]))) {
      charging.add(p.originalIdent);
    } else if (cmd === "-miss" && ctx) {
      const target = get(args[2]) ?? (ctx.accuracy.size === 1 ? byKey([...ctx.accuracy.keys()][0]) : null);
      if (target) ctx.missed.add(target.originalIdent);
    } else if (cmd === "-immune" && ctx && p) {
      ctx.void.add(p.originalIdent);
    } else if (cmd === "-activate" && ctx && p && PROTECTS.has(toId(String(args[2]).replace(/^move:\s*/i, "")))) {
      ctx.void.add(p.originalIdent);
    } else if (cmd === "-fail" && ctx && p && p.originalIdent === ctx.user) {
      for (const k of ctx.accuracy.keys()) ctx.void.add(k);
    } else if (cmd === "-crit" && ctx && p) {
      ctx.crit.add(p.originalIdent);
    } else if (cmd === "cant" && p) {
      const w = flinchWatch.get(p.originalIdent);
      if (w && toId(args[2]) === "flinch") {
        flinchWatch.delete(p.originalIdent);
        settleFlinch(w, true);
      }
    }

    if (cmd === "move" && p) {
      // The foe this Pokémon is about to act: a flinch chance on it came to nothing.
      const w = flinchWatch.get(p.originalIdent);
      if (w) {
        flinchWatch.delete(p.originalIdent);
        settleFlinch(w, false);
      }
    }

    try {
      battle.add(args as never, kwArgs as never);
    } catch {
      // A line the tracker can't follow: carry on.
    }

    // After it.
    if (cmd === "player" && (args[1] === "p1" || args[1] === "p2") && args[2]) players[args[1] === "p1" ? 0 : 1] = args[2];
    if (cmd === "win") winner = args[1] === players[0] ? 0 : args[1] === players[1] ? 1 : null;
    if (cmd === "turn") {
      turn = Number(args[1]) || turn + 1;
      notes[turn] ??= [];
      onField.clear();
      for (const side of [battle.p1, battle.p2]) for (const a of side.active) if (a && !a.fainted) onField.add(stat(a).key);
      for (const key of onField) mons.get(key)!.turns += 1;
    }
    if (switching && ident) {
      const now = get(ident);
      if (now) {
        const m = stat(now);
        m.species = now.speciesForme;
        m.sprite = spriteOf(m.species);
        const s = sideOf(ident)!;
        if (turn === 0 && leads[s] === null) leads[s] = m.species;
        if (turn > 0 && !onField.has(m.key)) {
          onField.add(m.key);
          m.turns += 1;
        }
        // Back with more HP than it left with (Regenerator, Wish…): healing the log didn't show line by line.
        const hp = pctOf(now);
        if (p && p === now && hpBefore > 0 && hp > hpBefore) m.healed += hp - hpBefore;
        justIn = now.originalIdent;
        charging.delete(now.originalIdent);
        if (cmd === "switch" && turn > 0 && !afterUpkeep && !(ctx && sideOf(ctx.user) === s)) note({ kind: "switch", side: s, mon: m.species });
      }
    } else if (cmd === "move" || cmd === "turn" || cmd === "upkeep") {
      justIn = null;
    }

    if (cmd === "-damage" && p) {
      const wasCrit = !!ctx && ctx.crit.has(p.originalIdent);
      const direct = !kwArgs.from && !!ctx && sideOf(ctx.user) !== sideOf(args[1]);
      damage(p, hpBefore, kwArgs);
      if (direct && ctx) onHit(ctx, p, hpBefore, wasCrit, false);
    } else if (cmd === "-activate" && ctx && p && kwArgs.damage && /substitute/i.test(String(args[2]))) {
      // A hit on a substitute: it could crit, but nothing gets through.
      if (sideOf(ctx.user) !== sideOf(args[1])) onHit(ctx, p, hpBefore, ctx.crit.has(p.originalIdent), true);
    } else if (cmd === "-end" && ctx && p && /substitute/i.test(String(args[2])) && !kwArgs.from && sideOf(ctx.user) !== sideOf(args[1])) {
      // The hit that broke a substitute.
      onHit(ctx, p, hpBefore, ctx.crit.has(p.originalIdent), true);
    } else if (cmd === "-heal" && p && /revival blessing/i.test(String(kwArgs.from ?? ""))) {
      // Back from fainting: it can be knocked out again.
      const m = stat(p);
      m.fainted = false;
      m.healed += pctOf(p);
    } else if (cmd === "-heal" && p) {
      const gained = Math.max(0, pctOf(p) - hpBefore);
      stat(p).healed += gained;
    } else if (cmd === "-sethp" && p) {
      const delta = pctOf(p) - hpBefore;
      if (delta > 0) stat(p).healed += delta;
      else add(stat(p).takenIndirect, "other", -delta);
    } else if (cmd === "faint" && p) {
      // Fainting with HP left: it went down by its own move (Explosion, Memento, Final Gambit…) or Destiny Bond, Perish Song.
      if (hpBefore > 0) {
        lastHurt.set(p.originalIdent, { by: null, how: ctx?.user === p.originalIdent ? ctx.move.name : null });
        add(stat(p).takenIndirect, "other", hpBefore);
      }
      settleKo(p);
    } else if (cmd === "-status" && p) {
      const status = String(args[2]);
      const of = get(kwArgs.of as string | undefined);
      let by: string | null = null;
      if (kwArgs.from) {
        by = of && sideOf(of.originalIdent) !== sideOf(p.originalIdent) ? of.originalIdent : null;
      } else if (justIn === p.originalIdent && (status === "psn" || status === "tox")) {
        by = hazardBy[sideOf(p.originalIdent)!].get("toxicspikes") ?? null;
        note({ kind: "status", side: sideOf(p.originalIdent) === 0 ? 1 : 0, mon: speciesOf(by), target: stat(p).species, detail: status, move: "Toxic Spikes" });
      } else if (ctx && sideOf(ctx.user) !== sideOf(p.originalIdent)) {
        by = ctx.user;
        ctx.seen.status.set(p.originalIdent, status);
        const secondary = ctx.move.secondaries?.some((s) => s.status === status && (s.chance ?? 100) < 100);
        if (!secondary) note({ kind: "status", side: ctx.side, mon: ctx.species, target: stat(p).species, move: ctx.move.name, detail: status });
      }
      statusBy.set(p.originalIdent, by);
      if (by && kwArgs.from) note({ kind: "status", side: sideOf(by)!, mon: speciesOf(by), target: stat(p).species, detail: status });
    } else if (cmd === "-start" && ctx && p && toId(args[2]) === "confusion" && !kwArgs.fatigue && sideOf(ctx.user) !== sideOf(p.originalIdent)) {
      ctx.seen.confusion.add(p.originalIdent);
    } else if (cmd === "-unboost" && ctx && p && !kwArgs.from && sideOf(ctx.user) !== sideOf(p.originalIdent)) {
      const set = ctx.seen.drops.get(p.originalIdent) ?? new Set<string>();
      set.add(String(args[2]));
      ctx.seen.drops.set(p.originalIdent, set);
    } else if (cmd === "-boost" && ctx && p && !kwArgs.from && p.originalIdent === ctx.user) {
      ctx.seen.raises.add(String(args[2]));
    } else if (cmd === "-sidestart") {
      const side = sideOf(args[1]);
      const cond = toId(String(args[2]).replace(/^move:\s*/i, ""));
      if (side !== null && HAZARDS.has(cond)) {
        const setter = ctx && sideOf(ctx.user) !== side ? ctx.user : null;
        if (setter) hazardBy[side].set(cond, setter);
        note({ kind: "hazard", side: side === 0 ? 1 : 0, mon: setter ? speciesOf(setter) : "", detail: Dex.moves.get(cond).name || String(args[2]) });
      }
    } else if (cmd === "-weather") {
      const w = toId(args[1]);
      if (!kwArgs.upkeep) {
        const of = get(kwArgs.of as string | undefined);
        weatherBy = of ? of.originalIdent : ctx ? ctx.user : null;
        if (w && w !== "none") note({ kind: "weather", side: weatherBy ? sideOf(weatherBy)! : 0, mon: speciesOf(weatherBy), detail: String(args[1]) });
        if (!w || w === "none") weatherBy = null;
      }
    } else if (cmd === "-fieldstart" && /terrain/i.test(String(args[1]))) {
      const of = get(kwArgs.of as string | undefined);
      const by = of ? of.originalIdent : ctx?.user ?? null;
      note({ kind: "terrain", side: by ? sideOf(by)! : 0, mon: speciesOf(by), detail: String(args[1]).replace(/^move:\s*/i, "") });
    } else if (cmd === "-terastallize" && p) {
      note({ kind: "tera", side: sideOf(args[1])!, mon: stat(p).species, detail: String(args[2]) });
    }
  }
  settleMove();

  function onHit(c: MoveCtx, target: Pokemon, hpBefore: number, crit: boolean, onSub: boolean) {
    const foe: StatsSide = c.side === 0 ? 1 : 0;
    const user = byKey(c.user);
    const move = c.move;
    const tKey = target.originalIdent;
    c.crit.delete(tKey);
    // Crit odds for this hit.
    if (move.exists && move.category !== "Status" && !move.ohko && !NO_CRIT_MOVES.has(move.id) && typeof move.damage !== "number" && move.damage !== "level") {
      const tAbility = abilityOf(target);
      const blocked = tAbility === "battlearmor" || tAbility === "shellarmor" || !!(target.side.sideConditions as Record<string, unknown>).luckychant;
      let p = 0;
      if (!blocked) {
        if (move.willCrit || (user && (user.volatiles.laserfocus || (abilityOf(user) === "merciless" && /psn|tox/.test(target.status ?? ""))))) p = 1;
        else p = critChance(battle.gen.num, critStage({ critRatio: move.critRatio, focusEnergy: !!user?.volatiles.focusenergy || !!user?.volatiles.dragoncheer, item: user ? itemOf(user) : "", ability: user ? abilityOf(user) : "", species: c.species }));
      }
      if (p > 0 || crit) {
        const q = crit ? Math.max(p, 1 / 24) : p;
        // A sure crit (Frost Breath, Laser Focus) is counted with its odds, 1: it moves nothing.
        addChance(luck[c.side].critsLanded, q, crit);
        addChance(luck[foe].critsReceived, q, crit);
        if (crit) {
          note({ kind: "crit", side: c.side, mon: c.species, target: speciesOf(tKey), move: move.name, chance: q });
          if (q < 1) luckEvents.push({ turn: c.turn, side: c.side, kind: "crit", text: `${c.species}'s ${move.name} landed a critical hit on ${speciesOf(tKey)}`, chance: q });
        }
      }
    }
    if (onSub || !user) return;
    const survived = !target.fainted && target.hp > 0;
    // Secondary effects the hit could have had.
    const secs = move.secondaries ?? [];
    const userAbility = abilityOf(user);
    const tAbility = abilityOf(target);
    const tItem = itemOf(target);
    const hit: HitRecord = { target: tKey, secondaries: [], survived };
    if (secs.length && userAbility !== "sheerforce") {
      const mult = c.serene ? 2 : 1;
      for (const s of secs) {
        const chance = Math.min(100, (s.chance ?? 100) * mult) / 100;
        if (chance >= 1) continue;
        const shielded = tAbility === "shielddust" || tItem === "covertcloak";
        if (s.self?.boosts) {
          const stats = Object.keys(s.self.boosts);
          if (stats.some((st) => (user.boosts[st as keyof typeof user.boosts] ?? 0) < 6)) hit.secondaries.push({ kind: "raise", p: chance, stats });
          continue;
        }
        if (!survived || shielded) continue;
        if (s.status) {
          const sideConds = target.side.sideConditions as Record<string, unknown>;
          if (!target.status && !statusImmune(s.status, target.types, battle.gen.num, toId(battle.field.weather)) && !sideConds.safeguard) hit.secondaries.push({ kind: "status", p: chance, status: s.status });
        } else if (s.volatileStatus === "flinch") {
          if (!target.moveThisTurn && tAbility !== "innerfocus") {
            flinchWatch.set(tKey, { by: c.user, side: c.side, move: move.name, p: chance, target: tKey });
          }
        } else if (s.volatileStatus === "confusion") {
          if (!target.volatiles.confusion) hit.secondaries.push({ kind: "confusion", p: chance });
        } else if (s.boosts) {
          const stats = Object.keys(s.boosts);
          if (stats.some((st) => (target.boosts[st as keyof typeof target.boosts] ?? 0) > -6)) hit.secondaries.push({ kind: "drop", p: chance, stats });
        }
      }
    }
    c.hits.push(hit);
    // The damage roll: a plain hit (no crit, one hit, not a KO) on a percentage bar.
    if (!crit && survived && opts.placeRoll && !move.multihit && hpBefore > 0) {
      const defender = snapshot(target);
      const attacker = snapshot(user);
      const before = Math.round(hpBefore);
      const position =
        Number.isInteger(hpBefore) && target.maxhp === 100
          ? opts.placeRoll({
              gen: battle.gen.num,
              move: move.name,
              attacker,
              defender: { ...defender, hp: before },
              attackerConditions: conditionsOf(battle, c.side),
              defenderConditions: conditionsOf(battle, foe),
              weather: toId(battle.field.weather),
              terrain: toId(battle.field.terrain),
              before,
              after: Math.round(pctOf(target)),
            })
          : null;
      if (position === null) rollsCount.unplaced += 1;
      else {
        rollsCount.placed += 1;
        addRoll(luck[c.side].rollsOwn, position);
        addRoll(luck[foe].rollsReceived, position);
      }
    }
  }

  function settleFlinch(w: { by: string; side: StatsSide; move: string; p: number; target: string }, happened: boolean) {
    const foe: StatsSide = w.side === 0 ? 1 : 0;
    addChance(luck[w.side].procsLanded, w.p, happened);
    addChance(luck[foe].procsReceived, w.p, happened);
    if (happened) {
      luckEvents.push({ turn, side: w.side, kind: "proc", text: `${speciesOf(w.by)}'s ${w.move} made ${speciesOf(w.target)} flinch`, chance: w.p });
      note({ kind: "flinch", side: w.side, mon: speciesOf(w.by), target: speciesOf(w.target), move: w.move, chance: w.p });
    }
  }

  function settleKo(p: Pokemon) {
    const m = stat(p);
    if (m.fainted) return;
    m.fainted = true;
    const hurt = lastHurt.get(m.key);
    const by = hurt?.by && sideOf(hurt.by) !== m.side ? hurt.by : null;
    m.koBy = by;
    if (by) {
      const k = mons.get(by);
      if (k) k.kos += 1;
    }
    // A KO is good for the other side, whoever (or whatever) did it.
    note({ kind: "ko", side: m.side === 0 ? 1 : 0, mon: by ? speciesOf(by) : "", target: m.species, detail: hurt?.how ?? undefined });
  }

  const sideLuck = (t: Tallies): SideLuck => {
    const s = luckScore(t);
    return { ...t, score: Math.round(s.score * 100) / 100, sd: Math.round(s.sd * 100) / 100, parts: s.parts };
  };
  const list = [...mons.values()].map((m) => ({
    ...m,
    dealt: round1(m.dealt),
    dealtHp: m.dealtHp === null ? null : Math.round(m.dealtHp),
    dealtIndirect: round1(m.dealtIndirect),
    taken: round1(m.taken),
    healed: round1(m.healed),
    takenIndirect: Object.fromEntries(Object.entries(m.takenIndirect).map(([k, v]) => [k, round1(v ?? 0)])),
  }));
  return {
    version: STATS_VERSION,
    gen: battle.gen.num,
    players,
    winner,
    turns: turn,
    mons: list,
    luck: [sideLuck(luck[0]), sideLuck(luck[1])],
    luckEvents: luckEvents.sort((a, b) => a.turn - b.turn),
    notes: Array.from({ length: turn + 1 }, (_, t) => notes[t] ?? []),
    leads,
    rolls: rollsCount,
  };
}

interface Tallies {
  critsLanded: LuckTally;
  critsReceived: LuckTally;
  missesOwn: LuckTally;
  missesFoe: LuckTally;
  procsLanded: LuckTally;
  procsReceived: LuckTally;
  rollsOwn: RollTally;
  rollsReceived: RollTally;
}

const newTallies = (): Tallies => ({
  critsLanded: emptyTally(),
  critsReceived: emptyTally(),
  missesOwn: emptyTally(),
  missesFoe: emptyTally(),
  procsLanded: emptyTally(),
  procsReceived: emptyTally(),
  rollsOwn: emptyRolls(),
  rollsReceived: emptyRolls(),
});

function add(table: Partial<Record<IndirectKind, number>>, kind: IndirectKind, n: number) {
  if (n > 0) table[kind] = (table[kind] ?? 0) + n;
}

export { percent as luckPercent };
