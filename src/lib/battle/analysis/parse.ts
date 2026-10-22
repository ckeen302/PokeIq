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
}

export interface SideState {
  name: string;
  /** The key of the Pokémon in battle (singles: slot a). */
  active: (string | null)[];
  /** Every Pokémon seen so far, in order of appearance. */
  team: MonState[];
  /** How many Pokémon the side brought. */
  size: number;
  /** Hazards and screens: id → layers. */
  conditions: Record<string, number>;
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
}

export type Action =
  | { kind: "move"; mon: string; move: string; missed: boolean }
  | { kind: "switch"; from: string | null; to: string }
  | { kind: "tera"; mon: string; type: string };

/** What happened in a turn, per side, from the log. */
export interface TurnEvents {
  turn: number;
  /** Per side: its choices in order (a Tera, then a move or a switch); forced replacements after a faint aren't choices. */
  actions: [Action[], Action[]];
  /** Keys of the Pokémon that fainted during the turn. */
  fainted: string[];
  /** The first move each side's Pokémon used on the other side, with its target's HP before and after. */
  hits: { by: string; move: string; target: string; before: number; after: number }[];
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

function monState(p: Pokemon, active: boolean): MonState {
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
  };
}

function sideState(side: Side, teraUsed: boolean): SideState {
  const conditions: Record<string, number> = {};
  for (const [id, c] of Object.entries(side.sideConditions)) conditions[id] = c.level || 1;
  return {
    name: side.name,
    active: side.active.map((p) => (p && !p.fainted ? p.originalIdent : null)),
    team: side.team.map((p) => monState(p, side.active.includes(p))),
    size: side.totalPokemon || 6,
    conditions,
    teraUsed: teraUsed || side.team.some((p) => !!p.terastallized),
  };
}

function snapshot(b: Battle, turn: number, teraUsed: [boolean, boolean]): TurnState {
  const left = (s: { minDuration: number; maxDuration: number } | undefined) => s?.maxDuration ?? 0;
  return {
    turn,
    sides: [sideState(b.p1, teraUsed[0]), sideState(b.p2, teraUsed[1])],
    weather: toId(b.field.weather),
    weatherTurns: b.field.weather ? left(b.field.weatherState) : 0,
    terrain: toId(b.field.terrain),
    terrainTurns: b.field.terrain ? left(b.field.terrainState) : 0,
  };
}

const sideOf = (ident: string | undefined): SideIndex | null => (ident?.startsWith("p1") ? 0 : ident?.startsWith("p2") ? 1 : null);

/** Reads a replay's log. Throws only on a log with no turns at all. */
export function parseReplay(log: readonly string[]): ParsedBattle {
  const battle = new Battle(gens);
  const turns: TurnState[] = [];
  const events: TurnEvents[] = [];
  let doubles = false;
  let winner: SideIndex | null = null;
  let current: TurnEvents | null = null;
  const faintedThisTurn = new Set<SideIndex>();
  const teraUsed: [boolean, boolean] = [false, false];
  // "p1a: Name" → "p1: Name", the tracker's originalIdent (a switch line names the Pokémon coming in, not the one out).
  const keyOf = (ident: string | undefined): string => (sideOf(ident) === null ? "" : (ident ?? "").replace(/^(p[12])[a-c]?: /, "$1: "));
  const hpOf = (ident: string | undefined) => {
    const p = battle.getPokemon(ident as never);
    return p && p.maxhp ? Math.round((100 * p.hp) / p.maxhp) : 0;
  };
  let pendingHit: { by: string; move: string; target: string; before: number; ident: string } | null = null;
  const flushHit = () => {
    if (pendingHit && current) {
      current.hits.push({ by: pendingHit.by, move: pendingHit.move, target: pendingHit.target, before: pendingHit.before, after: hpOf(pendingHit.ident) });
    }
    pendingHit = null;
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
    if (cmd === "gametype") doubles = args[1] === "doubles";
    if (cmd === "-terastallize" && sideOf(args[1]) !== null) teraUsed[sideOf(args[1])!] = true;
    if (cmd === "win") winner = args[1] === battle.p1.name ? 0 : args[1] === battle.p2.name ? 1 : null;

    // Events, read before the tracker moves on (a switch needs who was out before it).
    if (current) {
      const side = sideOf(args[1]);
      if (cmd === "move" && side !== null && !kwArgs.from) {
        flushHit();
        const by = keyOf(args[1]);
        const move = Dex.moves.get(args[2] ?? "").name || args[2] || "";
        current.actions[side].push({ kind: "move", mon: by, move, missed: !!kwArgs.miss });
        const targetSide = sideOf(args[3]);
        if (targetSide !== null && targetSide !== side && !kwArgs.miss) {
          pendingHit = { by, move, target: keyOf(args[3]), before: hpOf(args[3]), ident: args[3]! };
        }
      } else if (cmd === "move") {
        flushHit();
      }
      if (cmd === "switch" && side !== null && !faintedThisTurn.has(side)) {
        const acted = current.actions[side].some((a) => a.kind !== "tera");
        const from = battle[side === 0 ? "p1" : "p2"].active[0]?.originalIdent ?? null;
        // A switch after this side already moved is a pivot (U-turn, Eject Button…), not its choice.
        if (!acted) current.actions[side].push({ kind: "switch", from, to: keyOf(args[1]) });
      }
      if (cmd === "-terastallize" && side !== null) current.actions[side].push({ kind: "tera", mon: keyOf(args[1]), type: args[2] ?? "" });
      if (cmd === "faint" && side !== null) {
        current.fainted.push(keyOf(args[1]));
        faintedThisTurn.add(side);
      }
    }

    try {
      battle.add(args as never, kwArgs as never);
    } catch {
      // A line the tracker can't follow: carry on with the next.
    }

    if (cmd === "turn") {
      flushHit();
      const t = Number(args[1]);
      turns[t] = snapshot(battle, t, teraUsed);
      current = { turn: t, actions: [[], []], fainted: [], hits: [] };
      events[t] = current;
      faintedThisTurn.clear();
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
  return { gen: battle.gen.num, doubles, turns, events, revealed, winner, lastTurn };
}
