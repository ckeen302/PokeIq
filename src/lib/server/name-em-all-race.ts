import "server-only";
import { PVP_AWAY_MS, PVP_LEAD_MS } from "@/lib/pvp-types";
import type { DuelStatus } from "@/lib/duel-types";
import { RACE_MAX, RACE_MIN, type NeaRaceStanding, type NeaRaceView } from "@/lib/name-em-all/race";
import { duelTable } from "./duel-store";
import { fail, type PvpFailure } from "./duel-core";
import { randomId } from "./crypto";
import { MIN_MS_PER_NAME } from "./name-em-all-board";

/**
 * Name 'em All races: 2 to 8 trainers, one category, one clock, joined from
 * a share link (the PokéConnections party's lobby, presence and storage).
 * Names are matched in each browser, as in the solo game, and reported
 * here as slot numbers; the server keeps each trainer's set, times each
 * name by its own clock and refuses names faster than anyone types.
 *
 * The first to name them all wins on the spot. Otherwise the race ends when
 * the clock runs out (most named wins, the earlier last name breaking a
 * tie) or when everyone has left. Nothing runs on a timer: each request
 * catches the race up.
 */

export interface RacePlayer {
  id: string;
  name: string;
  ready: boolean;
  seenAt: number;
  left?: boolean;
}

export interface NeaRace {
  v: 1;
  code: string;
  category: string;
  total: number;
  minutes: number;
  createdAt: number;
  status: DuelStatus;
  /** The host is seat 0. */
  players: RacePlayer[];
  startsAt?: number;
  /** Per seat once the race begins: slots named and when (ms after the start). */
  boards: { slots: number[]; times: number[] }[];
  end?: { at: number; winner: number | null };
}

/** Races are kept like duels (a few hours) in their own table, or in memory without Supabase. */
export const raceStore = duelTable<NeaRace>("name_em_all_races", "nea-race");

const SEEN_STEP_MS = 5_000;
export const RACE_AWAY_SHOWN_MS = 12_000;

const gone = (p: RacePlayer, now: number) => !!p.left || now - p.seenAt > PVP_AWAY_MS;
const endsAt = (d: NeaRace) => (d.startsAt ?? 0) + d.minutes * 60_000;

/** Seats best first: more named, then the earlier last name, then the seat. */
export function rankSeats(d: NeaRace): number[] {
  const last = (s: number) => d.boards[s]?.times.at(-1) ?? Infinity;
  const named = (s: number) => d.boards[s]?.slots.length ?? 0;
  return d.players.map((_, s) => s).sort((a, b) => named(b) - named(a) || last(a) - last(b) || a - b);
}

export function raceStandings(d: NeaRace, now: number): NeaRaceStanding[] {
  if (!d.boards.length) return [];
  return rankSeats(d).map((seat, i) => {
    const b = d.boards[seat];
    return {
      seat,
      name: d.players[seat].name,
      place: i + 1,
      named: b.slots.length,
      done: b.slots.length === d.total,
      out: d.status === "playing" ? gone(d.players[seat], now) : !!d.players[seat].left,
      ...(b.times.length && { ms: b.times[b.times.length - 1] }),
    };
  });
}

function finish(d: NeaRace, at: number) {
  const [first] = rankSeats(d);
  d.status = "finished";
  d.end = { at, winner: first !== undefined && (d.boards[first]?.slots.length ?? 0) > 0 ? first : null };
}

/** Applies what's due by `now`: walk-outs in the lobby, the clock, everyone gone. */
export function advanceRace(race: NeaRace, now: number): NeaRace {
  const d = structuredClone(race);
  if (d.status === "lobby") {
    const here = d.players.filter((p) => now - p.seenAt <= PVP_AWAY_MS);
    if (here.length < d.players.length) d.players = here;
    return d;
  }
  if (d.status !== "playing" || d.startsAt === undefined) return d;
  if (now >= endsAt(d)) finish(d, endsAt(d));
  else if (now > d.startsAt && d.players.every((p) => gone(p, now))) finish(d, now);
  return d;
}

export function touchRace(race: NeaRace, playerId: string | null, now: number): NeaRace {
  const d = structuredClone(race);
  const player = d.players.find((p) => p.id === playerId);
  if (player && d.status !== "finished" && now - player.seenAt >= SEEN_STEP_MS) player.seenAt = now;
  return advanceRace(d, now);
}

export type RaceOutcome = { ok: true; race: NeaRace } | PvpFailure;

export function createRace(name: string, code: string, category: string, total: number, minutes: number, now: number): { race: NeaRace; playerId: string } {
  const host: RacePlayer = { id: randomId(), name, ready: true, seenAt: now };
  return { race: { v: 1, code, category, total, minutes, createdAt: now, status: "lobby", players: [host], boards: [] }, playerId: host.id };
}

export function joinRace(race: NeaRace, name: string, now: number): { ok: true; race: NeaRace; playerId: string } | PvpFailure {
  const d = advanceRace(race, now);
  if (d.status !== "lobby") return fail(409, "This race has already started.");
  if (d.players.length >= RACE_MAX) return fail(409, `This race is full (${RACE_MAX} players).`);
  if (d.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return fail(409, `${name} is already in this race. Pick another name.`);
  const player: RacePlayer = { id: randomId(), name, ready: false, seenAt: now };
  d.players.push(player);
  return { ok: true, race: d, playerId: player.id };
}

function seated(race: NeaRace, playerId: string, now: number, act: (d: NeaRace, seat: number) => RaceOutcome): RaceOutcome {
  const d = touchRace(race, playerId, now);
  const seat = d.players.findIndex((p) => p.id === playerId);
  if (seat < 0) return fail(403, "You're not in this race.");
  return act(d, seat);
}

export function readyRace(race: NeaRace, playerId: string, ready: boolean, now: number): RaceOutcome {
  return seated(race, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The race has already started.");
    d.players[seat].ready = ready;
    return { ok: true, race: d };
  });
}

export function startRace(race: NeaRace, playerId: string, now: number): RaceOutcome {
  return seated(race, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The race has already started.");
    if (seat !== 0) return fail(403, "Only the host starts the race.");
    if (d.players.length < RACE_MIN) return fail(409, `Wait for at least ${RACE_MIN} players.`);
    const waiting = d.players.filter((p, i) => i !== 0 && !p.ready);
    if (waiting.length) return fail(409, `Waiting for ${waiting.map((p) => p.name).join(", ")} to ready up.`);
    d.status = "playing";
    d.startsAt = now + PVP_LEAD_MS;
    d.boards = d.players.map(() => ({ slots: [], times: [] }));
    return { ok: true, race: d };
  });
}

export function leaveRace(race: NeaRace, playerId: string, now: number): RaceOutcome {
  return seated(race, playerId, now, (d, seat) => {
    if (d.status === "finished") return { ok: true, race: d };
    if (d.status === "lobby") {
      d.players.splice(seat, 1);
      return { ok: true, race: d };
    }
    d.players[seat].left = true;
    d.players[seat].seenAt = now;
    return { ok: true, race: advanceRace(d, now) };
  });
}

/** New names from a trainer: slots of the category. Ones already named are ignored; too many too fast are refused. */
export function nameInRace(race: NeaRace, playerId: string, slots: number[], now: number): RaceOutcome {
  return seated(race, playerId, now, (d, seat) => {
    if (d.status !== "playing" || d.startsAt === undefined) return fail(409, d.status === "lobby" ? "The race hasn't started yet." : "This race is over.");
    if (now < d.startsAt) return fail(409, "The race hasn't started yet.");
    if (d.players[seat].left) return fail(409, "You left this race.");
    const board = d.boards[seat];
    const have = new Set(board.slots);
    const fresh = [...new Set(slots)].filter((s) => Number.isInteger(s) && s >= 0 && s < d.total && !have.has(s));
    const at = now - d.startsAt;
    if (board.slots.length + fresh.length > Math.floor(at / MIN_MS_PER_NAME) + 1) return fail(429, "Easy there, that's faster than anyone types.");
    for (const s of fresh) {
      board.slots.push(s);
      board.times.push(at);
    }
    if (board.slots.length === d.total) finish(d, now);
    return { ok: true, race: d };
  });
}

/** What one trainer (or a visitor) may see: everyone's counts, and only their own slots. */
export function raceView(race: NeaRace, playerId: string | null, now: number, rev: number): NeaRaceView {
  const seat = playerId ? race.players.findIndex((p) => p.id === playerId) : -1;
  return {
    kind: "nea-race",
    code: race.code,
    rev,
    now,
    status: race.status,
    you: seat >= 0 ? seat : null,
    min: RACE_MIN,
    max: RACE_MAX,
    category: race.category,
    total: race.total,
    minutes: race.minutes,
    players: race.players.map((p, i) => ({ name: p.name, ready: p.ready, away: now - p.seenAt > RACE_AWAY_SHOWN_MS, host: i === 0, left: !!p.left })),
    ...(race.status === "playing" && race.startsAt !== undefined && { round: { startsAt: race.startsAt, endsAt: endsAt(race) } }),
    standings: raceStandings(race, now),
    ...(seat >= 0 && race.boards[seat] && { mine: race.boards[seat].slots }),
    ...(race.end && { end: race.end }),
  };
}
