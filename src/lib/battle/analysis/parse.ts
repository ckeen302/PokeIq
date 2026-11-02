import { Battle, type Pokemon, type Side } from "@pkmn/client";
import { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import { Protocol } from "@pkmn/protocol";

/**
 * A replay's public log, read turn by turn with @pkmn/client (the tracker
 * the battle screen uses): what everyone could see at the start of each
 * turn (HP as a percentage, status, stat stages, hazards, weather, who had
 * Terastallized), what each side did during it, and everything each
 * Pokémon revealed over the whole battle (moves, item, ability, Tera type).
 * Nothing here knows more than a spectator did.
 *
 * Double battles: each side's `active` lists its two positions (a, b), a
 * move names its target (a foe, the partner or itself) and, for a spread
 * move, every Pokémon it hit; a switch names the position it filled.
 */

const gens = new Generations(Dex);
const toId = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export type SideIndex = 0 | 1;

export interface MonState {
  /** "p1: Name": stable for the whole battle. */
  key: string;
  species: string;
  level: number;
  /** 0 to 100. */
  hp: number;
  fainted: boolean;
  status: string;
  /** Stat stages (only while active). */
  boosts: Record<string, number>;
  /** The Tera type it has Terastallized into, if it has. */
  terastallized: string;
  /** Its item as known at this point: a name, "" if it's gone (knocked off, eaten…), null if never revealed. */
  item: string | null;
  /** While active: it has used a move since it last came in (so Fake Out and First Impression won't work again). */
  moved?: boolean;
  /** While active: the last move it used (id), "" for none since it came in. */
  lastMove?: string;
  /** While active: how many turns in a row it has just protected itself (Protect, Detect…). */
  protectStreak?: number;
  /** While active: the volatile effects on it a spectator can see (ids: "substitute", "taunt", "encore", "confusion"…). */
  volatiles?: string[];
  /** Turns it has been asleep, or badly poisoned, so far. */
  sleepTurns?: number;
  toxicTurns?: number;
}

export interface SideState {
  name: string;
  /** The key of the Pokémon in each position (singles: a; doubles: a, b), null for an empty one. */
  active: (string | null)[];
  /** Every Pokémon seen so far, in order of appearance. */
  team: MonState[];
  /** How many Pokémon the side brought. */
  size: number;
  /** Hazards, screens, Tailwind…: id → layers. */
  conditions: Record<string, number>;
  /** Turns left of the conditions that run out (screens, Tailwind), the most it could be. */
  conditionTurns: Record<string, number>;
  teraUsed: boolean;
}

export interface TurnState {
  turn: number;
  sides: [SideState, SideState];
  /** Showdown ids ("raindance"), "" for none. */
  weather: string;
  /** Turns of weather left as far as anyone can tell (the most it could be), 0 if unknown or unending. */
  weatherTurns: number;
  terrain: string;
  terrainTurns: number;
  /** Turns of Trick Room left (the most it could be), 0 for none. */
  trickRoom: number;
}

export type Action =
  | {
      kind: "move";
      mon: string;
      move: string;
      missed: boolean;
      /** The position it was used from (0 = a, 1 = b). */
      slot: number;
      /** The Pokémon it was aimed at (a foe, the partner or itself), null for none (a field move, or no target left). */
      target: string | null;
      /** A spread move: every Pokémon it hit (foes and the partner); null for a single-target move. */
      spread: string[] | null;
    }
  | { kind: "switch"; from: string | null; to: string; slot: number }
  | { kind: "tera"; mon: string; type: string; slot: number };

/** A move's hit on one Pokémon, with its HP before and after. */
export interface Hit {
  by: string;
  move: string;
  target: string;
  before: number;
  after: number;
  /** The target is on the mover's own side (a spread move hitting the partner). */
  ally: boolean;
  /** Part of a spread move. */
  spread: boolean;
}

/** What happened in a turn, per side, from the log. */
export interface TurnEvents {
  turn: number;
  /** Per side: its choices in order (a Tera, then a move or a switch); forced replacements after a faint aren't choices. */
  actions: [Action[], Action[]];
  /** Keys of the Pokémon that fainted during the turn. */
  fainted: string[];
  /** Every move's hit on a Pokémon other than its user (each target of a spread move), in order. */
  hits: Hit[];
  /** Keys of the Pokémon that protected themselves this turn (Protect, Detect…). */
  protected: string[];
}

export interface Revealed {
  key: string;
  species: string;
  level: number;
  moves: string[];
  /** The item it started with, as far as the log shows; null if never revealed. */
  item: string | null;
  ability: string | null;
  teraType: string | null;
}

export interface ParsedBattle {
  gen: number;
  doubles: boolean;
  /** The log's game type: "singles", "doubles", "triples", "freeforall", "multi". */
  gameType: string;
  /** turns[t]: the state at the start of turn t (turns[0] is unused). */
  turns: TurnState[];
  /** events[t]: what happened during turn t. */
  events: TurnEvents[];
  /** Everything each Pokémon revealed by the end, per side, by key. */
  revealed: [Map<string, Revealed>, Map<string, Revealed>];
  /** The winner's side, null for a draw or no result in the log. */
  winner: SideIndex | null;
  lastTurn: number;
}

function itemNow(p: Pokemon): string | null {
  if (p.item) return Dex.items.get(p.item).name;
  if (p.lastItem || p.itemEffect) return "";
  return null;
}

const PROTECTS = new Set(["protect", "detect", "spikyshield", "kingsshield", "banefulbunker", "silktrap", "burningbulwark", "obstruct", "maxguard"]);
export const isProtectMove = (move: string) => PROTECTS.has(toId(move));

function monState(p: Pokemon, active: boolean, streaks: Map<string, number>): MonState {
  const pct = p.fainted ? 0 : p.maxhp ? Math.max(1, Math.round((100 * p.hp) / p.maxhp)) : 100;
  return {
    key: p.originalIdent,
    species: p.speciesForme,
    level: p.level || 100,
    hp: pct,
    fainted: p.fainted || p.hp <= 0,
    status: p.status ?? "",
    boosts: active ? Object.fromEntries(Object.entries(p.boosts).filter(([, v]) => v)) : {},
    terastallized: p.terastallized ?? "",
    item: itemNow(p),
    moved: active && p.movesUsedWhileActive.length > 0,
    lastMove: active && p.movesUsedWhileActive.length ? toId(p.lastMove) : "",
    protectStreak: active ? (streaks.get(p.originalIdent) ?? 0) : 0,
    volatiles: active ? Object.keys(p.volatiles).map(toId).filter(Boolean) : [],
    sleepTurns: p.status === "slp" ? p.statusState.sleepTurns : 0,
    toxicTurns: p.status === "tox" ? p.statusState.toxicTurns : 0,
  };
}

function sideState(side: Side, teraUsed: boolean, streaks: Map<string, number>): SideState {
  const conditions: Record<string, number> = {};
  const conditionTurns: Record<string, number> = {};
  for (const [id, c] of Object.entries(side.sideConditions)) {
    conditions[id] = c.level || 1;
    // Tailwind's and screens' usual length (Light Clay's longer one is the exception).
    if (c.minDuration || c.maxDuration) conditionTurns[id] = c.minDuration || c.maxDuration;
  }
  return {
    name: side.name,
    active: side.active.map((p) => (p && !p.fainted ? p.originalIdent : null)),
    team: side.team.map((p) => monState(p, side.active.includes(p), streaks)),
    size: side.totalPokemon || 6,
    conditions,
    conditionTurns,
    teraUsed: teraUsed || side.team.some((p) => !!p.terastallized),
  };
}

function snapshot(b: Battle, turn: number, teraUsed: [boolean, boolean], streaks: Map<string, number>): TurnState {
  const left = (s: { minDuration: number; maxDuration: number } | undefined) => s?.maxDuration ?? 0;
  const trickRoom = b.field.pseudoWeather.trickroom as { minDuration: number; maxDuration: number } | undefined;
  return {
    turn,
    sides: [sideState(b.p1, teraUsed[0], streaks), sideState(b.p2, teraUsed[1], streaks)],
    weather: toId(b.field.weather),
    weatherTurns: b.field.weather ? left(b.field.weatherState) : 0,
    terrain: toId(b.field.terrain),
    terrainTurns: b.field.terrain ? left(b.field.terrainState) : 0,
    trickRoom: trickRoom ? trickRoom.minDuration || trickRoom.maxDuration || 1 : 0,
  };
}

const sideOf = (ident: string | undefined): SideIndex | null => (ident?.startsWith("p1") ? 0 : ident?.startsWith("p2") ? 1 : null);
/** "p1b: Name" → 1 (position a is 0). */
const slotOf = (ident: string | undefined): number => {
  const letter = /^p[12]([a-c])/.exec(ident ?? "")?.[1];
  return letter ? letter.charCodeAt(0) - 97 : 0;
};
/** Items and abilities that switch their holder out, not its trainer. */
const FORCED_OUT = /^(item: )?(eject button|eject pack)$|^ability: (emergency exit|wimp out)$/i;

/** Reads a replay's log. Throws only on a log with no turns at all. */
export function parseReplay(log: readonly string[]): ParsedBattle {
  const battle = new Battle(gens);
  const turns: TurnState[] = [];
  const events: TurnEvents[] = [];
  let doubles = false;
  let gameType = "singles";
  let winner: SideIndex | null = null;
  let current: TurnEvents | null = null;
  const faintedThisTurn = new Set<SideIndex>();
  const teraUsed: [boolean, boolean] = [false, false];
  // Turns in a row each Pokémon has protected itself, up to the current turn.
  const streaks = new Map<string, number>();
  // This turn: positions ("p1a") whose Pokémon has moved, positions about to be switched out by an item or ability, past the end-of-turn effects.
  const acted = new Set<string>();
  const forcedOut = new Set<string>();
  let afterUpkeep = false;
  // "p1a: Name" → "p1: Name", the tracker's originalIdent (a switch line names the Pokémon coming in, not the one out).
  const keyOf = (ident: string | undefined): string => (sideOf(ident) === null ? "" : (ident ?? "").replace(/^(p[12])[a-c]?: /, "$1: "));
  const position = (ident: string | undefined) => (ident ?? "").slice(0, 3);
  const sideAt = (s: SideIndex) => battle[s === 0 ? "p1" : "p2"];
  /** The Pokémon in a position ("p2b") right now, as a key. */
  const keyAt = (pos: string): string | null => {
    const s = sideOf(pos);
    if (s === null) return null;
    const p = sideAt(s).active[slotOf(pos)];
    return p ? p.originalIdent : null;
  };
  const hpOf = (key: string) => {
    const s = sideOf(key);
    const p = s === null ? undefined : sideAt(s).team.find((m) => m.originalIdent === key);
    return p && p.maxhp ? Math.round((100 * p.hp) / p.maxhp) : 0;
  };
  let pending: Omit<Hit, "after">[] = [];
  const flushHit = () => {
    if (current) for (const h of pending) current.hits.push({ ...h, after: hpOf(h.target) });
    pending = [];
  };

  for (const line of log) {
    let parsed: { args: readonly string[]; kwArgs: Record<string, unknown> };
    try {
      parsed = Protocol.parseBattleLine(line) as unknown as typeof parsed;
    } catch {
      continue;
    }
    const { args, kwArgs } = parsed;
    const cmd = args[0];
    if (cmd === "gametype") {
      gameType = String(args[1] ?? "singles");
      doubles = gameType === "doubles";
    }
    if (cmd === "-terastallize" && sideOf(args[1]) !== null) teraUsed[sideOf(args[1])!] = true;
    if (cmd === "win") winner = args[1] === battle.p1.name ? 0 : args[1] === battle.p2.name ? 1 : null;

    // Events, read before the tracker moves on (a switch needs who was out before it).
    if (current) {
      const side = sideOf(args[1]);
      // The HP a hit left is read once its own lines are done: at the next move, switch, item, ability or end of turn.
      if (cmd === "move" || cmd === "switch" || cmd === "drag" || cmd === "upkeep" || cmd === "faint" || ((cmd === "-heal" || cmd === "-damage") && kwArgs.from)) flushHit();
      if (cmd === "move" && side !== null && !kwArgs.from) {
        const by = keyOf(args[1]);
        const move = Dex.moves.get(args[2] ?? "").name || args[2] || "";
        const slot = slotOf(args[1]);
        acted.add(position(args[1]));
        const aimed = args[3] && sideOf(args[3]) !== null && !kwArgs.notarget ? args[3] : undefined;
        const spreadAt = typeof kwArgs.spread === "string" ? kwArgs.spread.split(",").map((x) => x.trim()).filter((x) => sideOf(x) !== null) : null;
        const spread = spreadAt ? spreadAt.map(keyAt).filter((k): k is string => !!k) : null;
        const target = aimed ? keyOf(aimed) : null;
        current.actions[side].push({ kind: "move", mon: by, move, missed: !!kwArgs.miss, slot, target, spread });
        if (!kwArgs.miss && !kwArgs.still) {
          const hitKeys = spread ?? (target && target !== by ? [target] : []);
          for (const t of hitKeys) {
            if (t === by) continue;
            pending.push({ by, move, target: t, before: hpOf(t), ally: sideOf(t) === side, spread: !!spread });
          }
        }
      }
      if (cmd === "switch" && side !== null && !faintedThisTurn.has(side) && !afterUpkeep) {
        const pos = position(args[1]);
        const slot = slotOf(args[1]);
        const from = sideAt(side).active[slot]?.originalIdent ?? null;
        // A switch after this position already moved is a pivot (U-turn, Baton Pass…), and one an item or ability forced isn't a choice either.
        if (!acted.has(pos) && !forcedOut.has(pos)) current.actions[side].push({ kind: "switch", from, to: keyOf(args[1]), slot });
        acted.add(pos);
      }
      if ((cmd === "-enditem" || cmd === "-activate") && side !== null) {
        const what = String(args[2] ?? "");
        if (FORCED_OUT.test(what)) forcedOut.add(position(args[1]));
      }
      if (cmd === "-singleturn" && side !== null && isProtectMove(String(args[2] ?? "").replace(/^move: /, ""))) {
        const k = keyOf(args[1]);
        if (!current.protected.includes(k)) current.protected.push(k);
      }
      if (cmd === "-terastallize" && side !== null) current.actions[side].push({ kind: "tera", mon: keyOf(args[1]), type: args[2] ?? "", slot: slotOf(args[1]) });
      if (cmd === "faint" && side !== null) {
        current.fainted.push(keyOf(args[1]));
        faintedThisTurn.add(side);
      }
      if (cmd === "upkeep") afterUpkeep = true;
    }

    try {
      battle.add(args as never, kwArgs as never);
    } catch {
      // A line the tracker can't follow: carry on with the next.
    }

    if (cmd === "turn") {
      flushHit();
      // Protect streaks: a Pokémon that protected itself last turn has a worse chance to do it again.
      if (current) {
        for (const k of [...streaks.keys()]) if (!current.protected.includes(k)) streaks.delete(k);
        for (const k of current.protected) streaks.set(k, (streaks.get(k) ?? 0) + 1);
      }
      const t = Number(args[1]);
      turns[t] = snapshot(battle, t, teraUsed, streaks);
      current = { turn: t, actions: [[], []], fainted: [], hits: [], protected: [] };
      events[t] = current;
      faintedThisTurn.clear();
      acted.clear();
      forcedOut.clear();
      afterUpkeep = false;
    }
  }
  flushHit();
  const lastTurn = turns.length - 1;
  if (lastTurn < 1) throw new Error("This replay has no turns to analyse.");
  for (let t = 1; t <= lastTurn; t++) turns[t] ??= turns[t - 1];

  const revealed: [Map<string, Revealed>, Map<string, Revealed>] = [new Map(), new Map()];
  ([battle.p1, battle.p2] as Side[]).forEach((side, s) => {
    for (const p of side.team) {
      const first = p.item ? Dex.items.get(p.item).name : p.lastItem ? Dex.items.get(p.lastItem).name : null;
      revealed[s].set(p.originalIdent, {
        key: p.originalIdent,
        species: p.speciesForme,
        level: p.level || 100,
        moves: p.moveSlots.map((m) => m.name).filter((m) => m && !/^(struggle|recharge)$/i.test(m)),
        item: first,
        ability: p.baseAbility ? Dex.abilities.get(p.baseAbility).name : p.ability ? Dex.abilities.get(p.ability).name : null,
        teraType: p.terastallized ?? null,
      });
    }
  });
  return { gen: battle.gen.num, doubles, gameType, turns, events, revealed, winner, lastTurn };
}
