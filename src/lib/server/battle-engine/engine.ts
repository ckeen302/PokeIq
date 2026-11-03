import "server-only";
import { Battle, PRNG, Teams } from "pokemon-showdown";
import { extractChannelMessages } from "pokemon-showdown/dist/sim/battle";
import type { PRNGSeed } from "pokemon-showdown/dist/sim/prng";
import type { BattleRequest } from "@/lib/battle/play";

/**
 * Pokémon Showdown's own simulator (the official `pokemon-showdown`
 * package), random teams included, so a battle here plays out exactly as
 * it would on Showdown: `npm run verify:showdown` plays thousands of
 * battles against it to prove it.
 *
 * The simulator as a pure "state in, state out" step, which suits a
 * stateless serverless function and one Supabase row per battle.
 *
 * - The `Battle.toJSON()` snapshot (`state`) is the fast way back in: about
 *   a millisecond to restore.
 * - The input log is the source of truth: every player and choice, replayable
 *   on any engine version. A battle saved by another engine version is
 *   rebuilt from it.
 * - Every new protocol line is split per viewer with the simulator's own
 *   `extractChannelMessages`, so a player only ever receives their own
 *   channel (and their own request). The state, the input log (both full
 *   teams), the seed and the omniscient channel never leave the server.
 *
 * Choices must always be explicit (with targets in doubles): a "default"
 * choice is logged without its target and wouldn't replay.
 */

/**
 * The engine and its version, stored on every battle (the installed
 * `pokemon-showdown` version: a test keeps them in step). Battles saved by
 * an earlier engine (@pkmn/sim "0.10.11") are rebuilt from their input log.
 */
export const SIM_VERSION = "pokemon-showdown@0.11.11";

/** A trainer's side: p1 and p2, and p3 and p4 in four-player battles. */
export type PlayerSide = "p1" | "p2" | "p3" | "p4";
/** A two-trainer battle's sides. */
export type SideID = "p1" | "p2";
/** A two-trainer battle's sides. */
export const SIDES: readonly SideID[] = ["p1", "p2"];
/** Every side a battle can have (Free-For-All and Multi Battles have four). */
export const ALL_SIDES: readonly PlayerSide[] = ["p1", "p2", "p3", "p4"];
/** The sides of a battle with `players` trainers. */
export const sidesFor = (players: number): readonly PlayerSide[] => (players === 4 ? ALL_SIDES : SIDES);
export const sideOf = (seat: number): PlayerSide => ALL_SIDES[seat] ?? "p1";
export const seatOfSide = (side: PlayerSide): number => Math.max(0, ALL_SIDES.indexOf(side));

/** What is persisted of the simulator. */
export interface SimSnapshot {
  simVersion: string;
  /** JSON.stringify(Battle.toJSON()). */
  state: string;
  inputLog: string[];
  /**
   * Choices already made for a turn that hasn't run yet (the other side still
   * owes one). The simulator writes choices into the input log only when the
   * turn runs, so a rebuild from the log re-applies these.
   */
  chosen?: Partial<Record<PlayerSide, string>>;
}

/** New protocol lines, per viewer (p3 and p4 only in four-player battles). */
export interface SimLines {
  p1: string[];
  p2: string[];
  p3?: string[];
  p4?: string[];
  spectator: string[];
}

export interface SimResult extends SimSnapshot {
  lines: SimLines;
  ended: boolean;
  /** The winner's side, or null (a tie, or not over). A Multi Battle's is the winning team's first side. */
  winner: PlayerSide | null;
  /** Every winning side (both partners in a Multi Battle). */
  winners: PlayerSide[];
  turn: number;
}

/** Lines no viewer needs: timestamps and the simulator's debug output. */
const DROPPED = /^\|(t:|debug)\|/;

export class SimReplayError extends Error {}

export const newSeed = (): string => PRNG.generateSeed();

/** A random team for a random format, packed. */
export function randomTeam(formatid: string, seed: string = newSeed()): string {
  return Teams.pack(Teams.generate(formatid, { seed: seed as PRNGSeed }));
}

/**
 * One request's worth of work on a battle: restore (or create) it, make
 * choices, then `result()` for the new snapshot and the new lines.
 */
export class SimSession {
  readonly battle: Battle;
  /** This battle's sides: p1 and p2, or all four. */
  readonly sides: readonly PlayerSide[];
  /** Lines produced since the last `result()`. */
  private lines: SimLines;
  private readonly errors: Partial<Record<PlayerSide, string[]>> = {};

  private constructor(battle: Battle) {
    this.battle = battle;
    this.sides = sidesFor(battle.sides.length);
    this.lines = blankLines(this.sides);
    for (const side of this.sides) this.errors[side] = [];
    (battle as { send: Battle["send"] }).send = (type: string, data: string | string[]) => {
      const text = Array.isArray(data) ? data.join("\n") : data;
      if (type === "update") {
        // `|split|pN` blocks: the exact line goes to pN, the public one to everyone else.
        const channels = extractChannelMessages(text, [0, ...this.sides.map((_, i) => i + 1)] as never);
        this.lines.spectator.push(...keep(channels[0]));
        this.sides.forEach((side, i) => this.lines[side]!.push(...keep(channels[(i + 1) as 1])));
      } else if (type === "sideupdate") {
        const side = text.slice(0, 2) as PlayerSide;
        const message = text.slice(3);
        // Requests aren't logged: `pending()` reads them from the (serialized) state.
        if (message.startsWith("|error|") && this.errors[side]) this.errors[side]!.push(message.slice("|error|".length));
      }
    };
  }

  /** A new battle: `p1` and `p2`, and in a four-player format `p3` and `p4` (or every seat in order as `players`). */
  static create(opts: {
    formatid: string;
    seed: string;
    p1?: { name: string; team: string };
    p2?: { name: string; team: string };
    players?: { name: string; team: string }[];
  }): SimSession {
    const session = new SimSession(new Battle({ formatid: opts.formatid as never, seed: opts.seed as PRNGSeed }));
    const players = opts.players ?? [opts.p1!, opts.p2!];
    players.forEach((p, i) => session.battle.setPlayer(sideOf(i), p));
    return session;
  }

  /** The battle as saved; a battle saved by another engine version is rebuilt from its input log. */
  static restore(snapshot: SimSnapshot): SimSession {
    if (snapshot.simVersion === SIM_VERSION) return new SimSession(Battle.fromJSON(snapshot.state));
    const battle = replay(snapshot.inputLog);
    for (const side of sidesFor(battle.sides.length)) {
      const choice = snapshot.chosen?.[side];
      if (choice && !battle.choose(side, choice)) throw new SimReplayError(`The rebuilt battle refused ${side}'s "${choice}".`);
    }
    battle.sentLogPos = battle.log.length;
    return new SimSession(battle);
  }

  get ended(): boolean {
    return this.battle.ended;
  }

  get turn(): number {
    return this.battle.turn;
  }

  /** The simulator's side object (p3 and p4 exist only in four-player battles). */
  side(side: PlayerSide) {
    return this.battle.sides[seatOfSide(side)];
  }

  /** The request `side` must answer now, or null (nothing asked, or already chosen). */
  pending(side: PlayerSide): BattleRequest | null {
    if (this.battle.ended) return null;
    const s = this.side(side);
    if (!s) return null;
    const request = s.activeRequest;
    if (!request || request.wait || s.isChoiceDone()) return null;
    return request as unknown as BattleRequest;
  }

  /** The raw request object (for telling a new request from the same one). */
  requestObject(side: PlayerSide): object | null {
    return this.side(side)?.activeRequest ?? null;
  }

  /** Applies one side's choice; on an illegal one, the simulator's reason. */
  choose(side: PlayerSide, choice: string): { ok: true } | { ok: false; error: string } {
    if (this.battle.ended) return { ok: false, error: "The battle is over." };
    this.errors[side] = [];
    if (this.battle.choose(side, choice)) return { ok: true };
    return { ok: false, error: (this.errors[side] ?? []).join(" ") || "That choice isn't possible right now." };
  }

  /**
   * Takes back `side`'s choice while the other side is still choosing
   * (Showdown's Cancel, under the format's Cancel Mod). Choices only reach
   * the input log once both sides have chosen, so nothing is logged.
   */
  undo(side: PlayerSide): { ok: true } | { ok: false; error: string } {
    if (this.battle.ended) return { ok: false, error: "The battle is over." };
    const s = this.side(side);
    if (!s?.activeRequest || s.activeRequest.wait || !s.isChoiceDone()) return { ok: false, error: "There's nothing to cancel." };
    this.errors[side] = [];
    this.battle.undoChoice(side);
    if (s.isChoiceDone()) return { ok: false, error: (this.errors[side] ?? []).join(" ").replace(/^\[[^\]]*\]\s*/, "") || "That choice can't be cancelled." };
    return { ok: true };
  }

  /**
   * A forfeit, a timeout or a disconnect: `side` loses. In a Free-For-All
   * only that trainer is out (the others battle on); in a Multi Battle
   * their team loses, as on Showdown.
   */
  lose(side: PlayerSide): void {
    if (this.battle.ended) return;
    this.battle.lose(side);
    this.battle.inputLog.push(`>forcelose ${side}`);
  }

  /** Sides with no Pokémon left (a Free-For-All's knocked-out trainers, a forfeit's side included). */
  out(): PlayerSide[] {
    return this.sides.filter((side) => this.side(side)!.pokemonLeft <= 0);
  }

  /** Neither side wins. */
  tie(): void {
    if (this.battle.ended) return;
    this.battle.tie();
    this.battle.inputLog.push(">forcetie");
  }

  /** Flushes the new lines (each line is handed over once) and serializes the battle. */
  result(): SimResult {
    this.battle.sendUpdates();
    const lines = this.lines;
    this.lines = blankLines(this.sides);
    const chosen: Partial<Record<PlayerSide, string>> = {};
    for (const side of this.sides) {
      const s = this.side(side)!;
      const request = s.activeRequest;
      if (!this.battle.ended && request && !request.wait && s.choice.actions.length && s.isChoiceDone()) chosen[side] = s.getChoice();
    }
    const winners = this.battle.ended ? winnerSides(this.battle) : [];
    return {
      simVersion: SIM_VERSION,
      state: JSON.stringify(this.battle.toJSON()),
      inputLog: [...this.battle.inputLog],
      chosen,
      lines,
      ended: this.battle.ended,
      winner: winners[0] ?? null,
      winners,
      turn: this.battle.turn,
    };
  }
}

function blankLines(sides: readonly PlayerSide[]): SimLines {
  const lines: SimLines = { p1: [], p2: [], spectator: [] };
  for (const side of sides) lines[side] ??= [];
  return lines;
}

function keep(lines: string[] | undefined): string[] {
  return (lines ?? []).filter((line) => !DROPPED.test(line));
}

/**
 * Who won: `battle.winner` is the winning side's name (a Multi Battle's is
 * both partners', "Red & Blue"); mapped back to the sides. Empty for a tie.
 */
export function winnerSides(battle: Battle): PlayerSide[] {
  const winner = battle.winner;
  if (!winner) return [];
  if (battle.sides.length === 4) {
    const sides = sidesFor(4);
    if (battle.gameType === "multi") {
      // Team 1 is p1 and p3, team 2 p2 and p4 (side.n % 2).
      const teams = [[0, 2], [1, 3]].map((t) => t.map((i) => sides[i]));
      const named = teams.find((t) => winner === t.map((s) => battle.sides[seatOfSide(s)].name).join(" & ") || winner === `${battle.sides[seatOfSide(t[0])].name} & ${battle.sides[seatOfSide(t[1])].name}`);
      if (named) return named;
      // Names that can't tell them apart: the team with Pokémon left.
      const left = teams.find((t) => t.some((s) => battle.sides[seatOfSide(s)].pokemonLeft > 0));
      return left ?? [];
    }
    const named = sides.filter((s) => battle.sides[seatOfSide(s)].name === winner);
    if (named.length === 1) return named;
    const standing = sides.filter((s) => battle.sides[seatOfSide(s)].pokemonLeft > 0);
    return standing.length === 1 ? standing : named.slice(0, 1);
  }
  const one = sideIdOf(battle, winner);
  return one ? [one] : [];
}

/** `battle.winner` is the winning side's name; map it back to the side. */
function sideIdOf(battle: Battle, winner: string | undefined): PlayerSide | null {
  if (!winner) return null;
  if (battle.p1.name === winner && battle.p2.name !== winner) return "p1";
  if (battle.p2.name === winner && battle.p1.name !== winner) return "p2";
  // Both sides share a name: the side that still has Pokémon (or didn't forfeit) won.
  return battle.p2.pokemonLeft === 0 || battle.p1.pokemonLeft > battle.p2.pokemonLeft ? "p1" : "p2";
}

function splitFirst(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/** Rebuilds a battle from its input log (engine upgrades, audits, replays). */
export function replay(inputLog: string[]): Battle {
  let battle: Battle | null = null;
  for (const line of inputLog) {
    const [cmd, rest] = splitFirst(line.slice(1), " ");
    if (cmd === "start") {
      battle = new Battle(JSON.parse(rest));
      (battle as { send: Battle["send"] }).send = () => {};
      continue;
    }
    if (!battle) throw new SimReplayError("The input log must start with >start.");
    if (cmd === "player") {
      const [slot, json] = splitFirst(rest, " ");
      battle.setPlayer(slot as PlayerSide, JSON.parse(json));
    } else if (cmd === "p1" || cmd === "p2" || cmd === "p3" || cmd === "p4") {
      if (!battle.choose(cmd, rest)) throw new SimReplayError(`The replay diverged at "${line}".`);
    } else if (cmd === "forcelose") {
      battle.lose(rest as PlayerSide);
      battle.inputLog.push(line);
    } else if (cmd === "forcetie") {
      battle.tie();
      battle.inputLog.push(line);
    } else if (cmd === "chat") {
      battle.inputLog.push(line);
    } else {
      throw new SimReplayError(`Unsupported input "${cmd}".`);
    }
  }
  if (!battle) throw new SimReplayError("The input log is empty.");
  battle.sentLogPos = battle.log.length;
  return battle;
}
