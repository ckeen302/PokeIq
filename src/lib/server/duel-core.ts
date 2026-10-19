import "server-only";
import { z } from "zod";
import { randomId, signToken, verifyToken } from "./crypto";
import { DUEL_NAME_RE, type DuelPlayerView, type DuelStatus } from "@/lib/duel-types";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { PVP_AWAY_MS, PVP_LEAD_MS, PVP_QUIET_MS, type PvpEnd, type PvpEndReason, type PvpKind } from "@/lib/pvp-types";

/**
 * What every duel shares: trainer names, signed seats, and (for the duels in
 * the `duels` table) the lobby, presence, forfeits and rematches.
 *
 * A game plugs in its rules (`PvpRules`): how play begins once both trainers
 * are ready, and the next step of play that is due. As with PokéGuessr duels,
 * nothing runs on a timer: each poll or action catches the duel up, every
 * step dated by the rules rather than by when the request arrived. All
 * functions are pure (they take `now` and return a new duel).
 */

/** A trainer's name in duels, battles and matchmaking: the opponent sees it. */
export const duelNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a trainer name")
  .max(24)
  .regex(DUEL_NAME_RE, "Use letters, numbers, spaces, _ . - ' only")
  .refine(isCleanName, NAME_REJECTED);

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** A trainer's secret: their seat in one duel, signed so nobody can act for anyone else. */
export function seatToken(purpose: string, code: string, playerId: string): string {
  return signToken(purpose, { d: code, p: playerId });
}

export function readSeatToken(purpose: string, token: unknown, code: string): string | null {
  const seat = verifyToken<{ d: string; p: string }>(purpose, token);
  return seat && seat.d === code && typeof seat.p === "string" ? seat.p : null;
}

/** Seats in the `duels` table (PokéGuessr duels sign theirs as "geo-duel"). */
export const pvpToken = (code: string, playerId: string) => seatToken("duel", code, playerId);
export const readPvpToken = (token: unknown, code: string) => readSeatToken("duel", token, code);

// ---------------------------------------------------------------------------
// The shared duel record
// ---------------------------------------------------------------------------

export interface PvpPlayer {
  id: string;
  name: string;
  ready: boolean;
  /** The trainer's last request (kept to the nearest few seconds, to spare writes). */
  seenAt: number;
}

export interface PvpBase {
  v: 1;
  kind: PvpKind;
  code: string;
  /** Plans the duel's rounds. Server-side only. */
  seed: string;
  createdAt: number;
  status: DuelStatus;
  players: PvpPlayer[];
  end?: PvpEnd;
  rematch?: string;
}

export interface PvpRules<D extends PvpBase> {
  /** Both trainers are ready: set up play, starting at `at`. */
  begin(d: D, at: number): void;
  /** Applies the next step of play due by `now` to `d`; false when nothing is due. */
  play(d: D, now: number): boolean;
  /** A duel like `like` (same game and settings) on a new `base`, with no play yet. */
  blank(base: PvpBase, like: D): D;
}

export type PvpFailure = { ok: false; status: number; error: string };
export type PvpOutcome<D> = { ok: true; duel: D } | PvpFailure;

export const fail = (status: number, error: string): PvpFailure => ({ ok: false, status, error });

/** Heartbeats move `seenAt` on in steps this big, so polling doesn't write every second. */
const SEEN_STEP_MS = 5_000;
/** Enough steps to catch up on any duel. */
const MAX_STEPS = 64;

export const seatOf = (duel: PvpBase, playerId: string | null) => (playerId ? duel.players.findIndex((p) => p.id === playerId) : -1);
/** The seat ahead on `score`, or null when level. */
export const leader = (score: number[]) => (score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1);

export function pvpBase(kind: PvpKind, code: string, players: PvpPlayer[], now: number, seed = randomId()): PvpBase {
  return { v: 1, kind, code, seed, createdAt: now, status: "lobby", players };
}

export const newSeat = (name: string, now: number): PvpPlayer => ({ id: randomId(), name, ready: false, seenAt: now });

export function finish(d: PvpBase, reason: PvpEndReason, winner: number | null, at: number) {
  d.status = "finished";
  d.end = { reason, winner, at };
}

/** The view fields every duel shares. */
export function baseView(duel: PvpBase, playerId: string | null, now: number, rev: number) {
  const seat = seatOf(duel, playerId);
  return {
    code: duel.code,
    status: duel.status,
    now,
    rev,
    you: seat >= 0 ? seat : null,
    players: duel.players.map((p): DuelPlayerView => ({ name: p.name, ready: p.ready, quiet: now - p.seenAt > PVP_QUIET_MS })),
    end: duel.end,
    rematch: duel.rematch,
  };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** A request from a trainer (or a visitor: null): marks them as here, then catches up. */
export function touchPvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, playerId: string | null, now: number): D {
  const d = structuredClone(duel);
  const player = d.players.find((p) => p.id === playerId);
  // After the end nobody can time out, so polls there (waiting for a rematch) write nothing.
  if (player && d.status !== "finished" && now - player.seenAt >= SEEN_STEP_MS) player.seenAt = now;
  return advancePvp(rules, d, now);
}

/** Applies every step that is due by `now`. */
export function advancePvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, now: number): D {
  const d = structuredClone(duel);
  for (let i = 0; i < MAX_STEPS && step(rules, d, now); i++);
  return d;
}

function step<D extends PvpBase>(rules: PvpRules<D>, d: D, now: number): boolean {
  if (d.status === "finished") return false;
  if (d.status === "lobby") {
    // Trainers who left the lobby free their seat for someone else.
    const here = d.players.filter((p) => now - p.seenAt <= PVP_AWAY_MS);
    if (here.length < d.players.length) {
      d.players = here;
      return true;
    }
    if (d.players.length === 2 && d.players.every((p) => p.ready)) {
      d.status = "playing";
      rules.begin(d, now + PVP_LEAD_MS);
      return true;
    }
    return false;
  }

  // A trainer who stopped responding forfeits (if both did, the one gone longer).
  const gone = d.players
    .map((p, seat) => ({ seat, at: p.seenAt + PVP_AWAY_MS }))
    .filter((p) => p.at < now)
    .sort((a, b) => a.at - b.at)[0];
  if (gone) {
    finish(d, "left", 1 - gone.seat, gone.at);
    return true;
  }
  return rules.play(d, now);
}

// ---------------------------------------------------------------------------
// Joining, the lobby and rematches
// ---------------------------------------------------------------------------

export function joinPvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, name: string, now: number): { ok: true; duel: D; playerId: string } | PvpFailure {
  const d = advancePvp(rules, duel, now);
  if (d.status !== "lobby") return fail(409, "This duel has already started.");
  if (d.players.length >= 2) return fail(409, "This duel is full.");
  if (d.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return fail(409, `${name} is already in this duel. Pick another name.`);
  }
  const seat = newSeat(name, now);
  d.players.push(seat);
  return { ok: true, duel: d, playerId: seat.id };
}

/** An action by a seated trainer: catch up, act, catch up again (an action can close a round). */
export function seated<D extends PvpBase>(
  rules: PvpRules<D>,
  duel: D,
  playerId: string,
  now: number,
  act: (d: D, seat: number) => PvpOutcome<D>
): PvpOutcome<D> {
  const d = touchPvp(rules, duel, playerId, now);
  const seat = seatOf(d, playerId);
  if (seat < 0) return fail(403, "You're not in this duel.");
  const out = act(d, seat);
  return out.ok ? { ok: true, duel: advancePvp(rules, out.duel, now) } : out;
}

export const notPlaying = (d: PvpBase) => fail(409, d.status === "lobby" ? "The duel hasn't started yet." : "This duel is over.");

export function readyPvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, playerId: string, ready: boolean, now: number): PvpOutcome<D> {
  return seated(rules, duel, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The duel has already started.");
    d.players[seat].ready = ready;
    return { ok: true, duel: d };
  });
}

/** Leaving the lobby frees your seat; leaving mid-duel forfeits it. */
export function leavePvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, playerId: string, now: number): PvpOutcome<D> {
  return seated(rules, duel, playerId, now, (d, seat) => {
    if (d.status === "lobby") d.players.splice(seat, 1);
    else if (d.status === "playing") finish(d, "left", 1 - seat, now);
    return { ok: true, duel: d };
  });
}

/** A rematch: the same game and trainers (same seats), a new seed. Both start un-ready, as if just seen. */
export function rematchPvp<D extends PvpBase>(rules: PvpRules<D>, old: D, code: string, now: number, seed?: string): D {
  const players = old.players.map((p) => ({ id: p.id, name: p.name, ready: false, seenAt: now }));
  return rules.blank(pvpBase(old.kind, code, players, now, seed), old);
}

/** Pressing Rematch: takes (or, if the lobby dropped them, retakes) your seat in the rematch, ready to go. */
export function takeRematchSeatPvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, playerId: string, name: string, now: number): PvpOutcome<D> {
  const d = touchPvp(rules, duel, playerId, now);
  let seat = seatOf(d, playerId);
  if (d.status !== "lobby") return seat >= 0 ? { ok: true, duel: d } : fail(409, "The rematch has already started.");
  if (seat < 0) {
    if (d.players.length >= 2) return fail(409, "The rematch is full.");
    d.players.push({ id: playerId, name, ready: false, seenAt: now });
    seat = d.players.length - 1;
  }
  d.players[seat].ready = true;
  return { ok: true, duel: advancePvp(rules, d, now) };
}

/** Records the rematch's code on the finished duel (the first trainer to ask sets it). */
export function linkRematchPvp<D extends PvpBase>(duel: D, code: string): PvpOutcome<D> {
  if (duel.status !== "finished") return fail(409, "The duel isn't over yet.");
  return { ok: true, duel: duel.rematch ? duel : { ...duel, rematch: code } };
}
