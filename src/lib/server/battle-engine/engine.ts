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

export type SideID = "p1" | "p2";
export const SIDES: readonly SideID[] = ["p1", "p2"];
export const sideOf = (seat: number): SideID => (seat === 0 ? "p1" : "p2");
export const seatOfSide = (side: SideID): 0 | 1 => (side === "p1" ? 0 : 1);

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
  chosen?: Partial<Record<SideID, string>>;
}

/** New protocol lines, per viewer. */
export interface SimLines {
  p1: string[];
  p2: string[];
  spectator: string[];
}

export interface SimResult extends SimSnapshot {
  lines: SimLines;
  ended: boolean;
  /** The winner's side, or null (a tie, or not over). */
  winner: SideID | null;
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
  /** Lines produced since the last `result()`. */
  private lines: SimLines = { p1: [], p2: [], spectator: [] };
  private readonly errors: Record<SideID, string[]> = { p1: [], p2: [] };

  private constructor(battle: Battle) {
    this.battle = battle;
    (battle as { send: Battle["send"] }).send = (type: string, data: string | string[]) => {
      const text = Array.isArray(data) ? data.join("\n") : data;
      if (type === "update") {
        // `|split|pN` blocks: the exact line goes to pN, the public one to everyone else.
        const channels = extractChannelMessages(text, [0, 1, 2]);
        this.lines.spectator.push(...keep(channels[0]));
        this.lines.p1.push(...keep(channels[1]));
        this.lines.p2.push(...keep(channels[2]));
      } else if (type === "sideupdate") {
        const side = text.slice(0, 2) as SideID;
        const message = text.slice(3);
        // Requests aren't logged: `pending()` reads them from the (serialized) state.
        if (message.startsWith("|error|") && this.errors[side]) this.errors[side].push(message.slice("|error|".length));
      }
    };
  }

  static create(opts: { formatid: string; seed: string; p1: { name: string; team: string }; p2: { name: string; team: string } }): SimSession {
    const session = new SimSession(new Battle({ formatid: opts.formatid as never, seed: opts.seed as PRNGSeed }));
    session.battle.setPlayer("p1", opts.p1);
    session.battle.setPlayer("p2", opts.p2);
    return session;
  }

  /** The battle as saved; a battle saved by another engine version is rebuilt from its input log. */
  static restore(snapshot: SimSnapshot): SimSession {
    if (snapshot.simVersion === SIM_VERSION) return new SimSession(Battle.fromJSON(snapshot.state));
    const battle = replay(snapshot.inputLog);
    for (const side of SIDES) {
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

  /** The request `side` must answer now, or null (nothing asked, or already chosen). */
  pending(side: SideID): BattleRequest | null {
    if (this.battle.ended) return null;
    const s = this.battle[side];
    const request = s.activeRequest;
    if (!request || request.wait || s.isChoiceDone()) return null;
    return request as unknown as BattleRequest;
  }

  /** The raw request object (for telling a new request from the same one). */
  requestObject(side: SideID): object | null {
    return this.battle[side].activeRequest;
  }

  /** Applies one side's choice; on an illegal one, the simulator's reason. */
  choose(side: SideID, choice: string): { ok: true } | { ok: false; error: string } {
    if (this.battle.ended) return { ok: false, error: "The battle is over." };
    this.errors[side] = [];
    if (this.battle.choose(side, choice)) return { ok: true };
    return { ok: false, error: this.errors[side].join(" ") || "That choice isn't possible right now." };
  }

  /** A forfeit, a timeout or a disconnect: `side` loses. */
  lose(side: SideID): void {
    if (this.battle.ended) return;
    this.battle.lose(side);
    this.battle.inputLog.push(`>forcelose ${side}`);
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
    this.lines = { p1: [], p2: [], spectator: [] };
    const chosen: Partial<Record<SideID, string>> = {};
    for (const side of SIDES) {
      const s = this.battle[side];
      const request = s.activeRequest;
      if (!this.battle.ended && request && !request.wait && s.choice.actions.length && s.isChoiceDone()) chosen[side] = s.getChoice();
    }
    return {
      simVersion: SIM_VERSION,
      state: JSON.stringify(this.battle.toJSON()),
      inputLog: [...this.battle.inputLog],
      chosen,
      lines,
      ended: this.battle.ended,
      winner: this.battle.ended ? sideIdOf(this.battle, this.battle.winner) : null,
      turn: this.battle.turn,
    };
  }
}

function keep(lines: string[] | undefined): string[] {
  return (lines ?? []).filter((line) => !DROPPED.test(line));
}

/** `battle.winner` is the winning side's name; map it back to the side. */
function sideIdOf(battle: Battle, winner: string | undefined): SideID | null {
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
      battle.setPlayer(slot as SideID, JSON.parse(json));
    } else if (cmd === "p1" || cmd === "p2") {
      if (!battle.choose(cmd, rest)) throw new SimReplayError(`The replay diverged at "${line}".`);
    } else if (cmd === "forcelose") {
      battle.lose(rest as SideID);
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
