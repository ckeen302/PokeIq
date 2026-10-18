import "server-only";
import { z } from "zod";
import { randomId, signToken, verifyToken } from "./crypto";
import { answerFor, isGeoSpec, measureGuess, planRounds } from "./geo";
import {
  DUEL_AWAY_MS,
  DUEL_COUNTDOWN_MS,
  DUEL_HP,
  DUEL_IDLE_ROUNDS,
  DUEL_LEAD_MS,
  DUEL_MAX_ROUNDS,
  DUEL_NAME_RE,
  DUEL_QUIET_MS,
  DUEL_REVEAL_MS,
  DUEL_ROUND_MS,
  duelMultiplier,
  type DuelEnd,
  type DuelEndReason,
  type DuelRoundResult,
  type DuelStatus,
  type DuelView,
} from "@/lib/duel-types";
import { GEO_STYLES, type GeoSpec } from "@/lib/geo-types";

/**
 * PokéGuessr duels: two trainers on the same rounds, GeoGuessr Duels style.
 *
 * A duel is a record on the server (duel-store.ts) and every rule is applied
 * here. Nothing runs on a timer: whenever either trainer polls or acts, the
 * duel catches up on whatever is due (a round closing, the next one starting,
 * a trainer timing out), and each step is dated by the rules rather than by
 * when the request arrived, so both trainers see the same duel. Views are cut
 * per trainer: the answer and the opponent's pin appear only once a round is
 * revealed. All functions are pure (they take `now` and return a new duel).
 */

type PlannedRound = ReturnType<typeof planRounds>[number];

interface DuelPlayer {
  id: string;
  name: string;
  ready: boolean;
  /** The trainer's last request (kept to the nearest few seconds, to spare writes). */
  seenAt: number;
}

interface DuelRound {
  plan: PlannedRound;
  startsAt: number;
  /** One per seat, null until that trainer guesses. */
  guesses: ({ x: number; y: number; at: number } | null)[];
  /** Trainers who pressed Next during the reveal. */
  skip: boolean[];
  /** Set by the reveal. */
  result?: { at: number; scores: number[]; squares: number[]; damage: number; hurt: number | null; hp: number[]; nextAt: number };
}

export interface Duel {
  v: 1;
  code: string;
  region: string;
  seed: string;
  createdAt: number;
  status: DuelStatus;
  players: DuelPlayer[];
  maxRounds: number;
  hp: number[];
  rounds: DuelRound[];
  end?: DuelEnd;
  rematch?: string;
}

export type DuelFailure = { ok: false; status: number; error: string };
export type DuelOutcome = { ok: true; duel: Duel } | DuelFailure;

const fail = (status: number, error: string): DuelFailure => ({ ok: false, status, error });
/** Heartbeats move `seenAt` on in steps this big, so polling doesn't write every second. */
const SEEN_STEP_MS = 5_000;
/** A guess sent just before the bell still counts if it arrives within this long after it. */
const GRACE_MS = 1_000;
/** Enough steps to catch up on any duel (each round has at most a reveal and a start). */
const MAX_STEPS = 4 * DUEL_MAX_ROUNDS + 8;

export const duelNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a trainer name")
  .max(24)
  .regex(DUEL_NAME_RE, "Use letters, numbers, spaces, _ . - ' only");

/**
 * The single-player engine's spec for a duel's map. A duel plays a streak's
 * rounds (every place once, in a seeded order) and takes as many as it needs.
 */
const specs = new Map<string, GeoSpec>();
function geoSpec(region: string): GeoSpec {
  const known = specs.get(region);
  if (known) return known;
  const style = GEO_STYLES.find((s) => isGeoSpec({ region, style: s, kind: "streak" }));
  if (!style) return { region, style: GEO_STYLES[0], kind: "streak" };
  const spec: GeoSpec = { region, style, kind: "streak" };
  specs.set(region, spec);
  return spec;
}

/** Whether a map can host a duel. */
export const isDuelMap = (region: string) => isGeoSpec(geoSpec(region));

/** Same route as the single-player game; screenshot ids are random, so the URL gives nothing away. */
const shotUrl = (round: PlannedRound) => `/api/geo/shot/${round.shot}`;
const seatOf = (duel: Duel, playerId: string | null) => (playerId ? duel.players.findIndex((p) => p.id === playerId) : -1);
const leader = (hp: number[]) => (hp[0] === hp[1] ? null : hp[0] > hp[1] ? 0 : 1);

/** When guessing closes: 90 s after the start, or 15 s after the first guess. */
function closesAt(round: DuelRound): number {
  const first = Math.min(...round.guesses.map((g) => g?.at ?? Infinity));
  return Math.min(round.startsAt + DUEL_ROUND_MS, first + DUEL_COUNTDOWN_MS);
}

// ---------------------------------------------------------------------------
// Player tokens
// ---------------------------------------------------------------------------

/** A trainer's secret: their seat in one duel, signed so nobody can act for anyone else. */
export function duelToken(code: string, playerId: string): string {
  return signToken("geo-duel", { d: code, p: playerId });
}

export function readDuelToken(token: unknown, code: string): string | null {
  const seat = verifyToken<{ d: string; p: string }>("geo-duel", token);
  return seat && seat.d === code && typeof seat.p === "string" ? seat.p : null;
}

// ---------------------------------------------------------------------------
// Creating and joining
// ---------------------------------------------------------------------------

function blankDuel(region: string, code: string, players: DuelPlayer[], now: number, seed = randomId()): Duel {
  const maxRounds = Math.min(DUEL_MAX_ROUNDS, planRounds(geoSpec(region), seed).length);
  return { v: 1, code, region, seed, createdAt: now, status: "lobby", players, maxRounds, hp: [DUEL_HP, DUEL_HP], rounds: [] };
}

export function createDuel(region: string, name: string, code: string, now: number, seed?: string): { duel: Duel; playerId: string } {
  const playerId = randomId();
  return { duel: blankDuel(region, code, [{ id: playerId, name, ready: false, seenAt: now }], now, seed), playerId };
}

export function joinDuel(duel: Duel, name: string, now: number): { ok: true; duel: Duel; playerId: string } | DuelFailure {
  const d = advanceDuel(duel, now);
  if (d.status !== "lobby") return fail(409, "This duel has already started.");
  if (d.players.length >= 2) return fail(409, "This duel is full.");
  if (d.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return fail(409, `${name} is already in this duel. Pick another name.`);
  }
  const playerId = randomId();
  d.players.push({ id: playerId, name, ready: false, seenAt: now });
  return { ok: true, duel: d, playerId };
}

/** A rematch: the same map and trainers (same seats), new places. Both start un-ready, as if just seen. */
export function rematchOf(old: Duel, code: string, now: number, seed?: string): Duel {
  return blankDuel(old.region, code, old.players.map((p) => ({ id: p.id, name: p.name, ready: false, seenAt: now })), now, seed);
}

/** Pressing Rematch: takes (or, if the lobby dropped them, retakes) your seat in the rematch, ready to go. */
export function takeRematchSeat(duel: Duel, playerId: string, name: string, now: number): DuelOutcome {
  const d = touchDuel(duel, playerId, now);
  let seat = seatOf(d, playerId);
  if (d.status !== "lobby") return seat >= 0 ? { ok: true, duel: d } : fail(409, "The rematch has already started.");
  if (seat < 0) {
    if (d.players.length >= 2) return fail(409, "The rematch is full.");
    d.players.push({ id: playerId, name, ready: false, seenAt: now });
    seat = d.players.length - 1;
  }
  d.players[seat].ready = true;
  return { ok: true, duel: advanceDuel(d, now) };
}

/** Records the rematch's code on the finished duel (the first trainer to ask sets it). */
export function linkRematch(duel: Duel, code: string): DuelOutcome {
  if (duel.status !== "finished") return fail(409, "The duel isn't over yet.");
  return { ok: true, duel: duel.rematch ? duel : { ...duel, rematch: code } };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** A request from a trainer (or a visitor: null) — marks them as here, then catches up. */
export function touchDuel(duel: Duel, playerId: string | null, now: number): Duel {
  const d = structuredClone(duel);
  const player = d.players.find((p) => p.id === playerId);
  if (player && now - player.seenAt >= SEEN_STEP_MS) player.seenAt = now;
  return advanceDuel(d, now);
}

/** Applies every step that is due by `now`. */
export function advanceDuel(duel: Duel, now: number): Duel {
  const d = structuredClone(duel);
  for (let i = 0; i < MAX_STEPS && step(d, now); i++);
  return d;
}

/** Applies the next due step to `d`; false when nothing is due. */
function step(d: Duel, now: number): boolean {
  if (d.status === "finished") return false;
  if (d.status === "lobby") {
    // Trainers who left the lobby free their seat for someone else.
    const here = d.players.filter((p) => now - p.seenAt <= DUEL_AWAY_MS);
    if (here.length < d.players.length) {
      d.players = here;
      return true;
    }
    if (d.players.length === 2 && d.players.every((p) => p.ready)) {
      d.status = "playing";
      d.rounds = [newRound(d, now + DUEL_LEAD_MS)];
      return true;
    }
    return false;
  }

  // A trainer who stopped responding forfeits (if both did, the one gone longer).
  const gone = d.players
    .map((p, seat) => ({ seat, at: p.seenAt + DUEL_AWAY_MS }))
    .filter((p) => p.at < now)
    .sort((a, b) => a.at - b.at)[0];
  if (gone) {
    finish(d, "left", 1 - gone.seat, gone.at);
    return true;
  }

  const round = d.rounds[d.rounds.length - 1];
  if (!round.result) {
    const close = closesAt(round);
    const all = round.guesses.every(Boolean);
    if (!all && now <= close + GRACE_MS) return false;
    reveal(d, round, all ? Math.max(...round.guesses.map((g) => g!.at)) : close + GRACE_MS);
    return true;
  }
  if (now < round.result.nextAt) return false;
  d.rounds.push(newRound(d, round.result.nextAt + DUEL_LEAD_MS));
  return true;
}

function newRound(d: Duel, startsAt: number): DuelRound {
  const plan = planRounds(geoSpec(d.region), d.seed)[d.rounds.length];
  return { plan, startsAt, guesses: d.players.map(() => null), skip: d.players.map(() => false) };
}

/** Scores the round. The lower score loses the difference times the round's multiplier. */
function reveal(d: Duel, round: DuelRound, at: number) {
  const index = d.rounds.indexOf(round);
  const measured = round.guesses.map((g) => (g ? measureGuess(geoSpec(d.region), round.plan, g.x, g.y) : null));
  const scores = measured.map((m) => m?.score ?? 0);
  const hurt = scores[0] === scores[1] ? null : scores[0] < scores[1] ? 0 : 1;
  const damage = hurt === null ? 0 : Math.round(Math.abs(scores[0] - scores[1]) * duelMultiplier(index));
  const hp = d.hp.map((h, seat) => (seat === hurt ? Math.max(0, h - damage) : h));
  round.result = { at, scores, squares: measured.map((m) => m?.squares ?? 0), damage, hurt, hp, nextAt: at + DUEL_REVEAL_MS };
  d.hp = hp;

  const idle = d.players.map((_, seat) => d.rounds.length >= DUEL_IDLE_ROUNDS && d.rounds.slice(-DUEL_IDLE_ROUNDS).every((r) => !r.guesses[seat]));
  if (hp.some((h) => h <= 0)) finish(d, "hp", hp[0] > 0 ? 0 : 1, at);
  else if (idle[0] !== idle[1]) finish(d, "idle", idle[0] ? 1 : 0, at);
  else if (idle[0]) finish(d, "idle", leader(hp), at);
  else if (d.rounds.length >= d.maxRounds) finish(d, "rounds", leader(hp), at);
}

function finish(d: Duel, reason: DuelEndReason, winner: number | null, at: number) {
  d.status = "finished";
  d.end = { reason, winner, at };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** An action by a seated trainer: catch up, act, catch up again (a guess can close the round). */
function seated(duel: Duel, playerId: string, now: number, act: (d: Duel, seat: number) => DuelOutcome): DuelOutcome {
  const d = touchDuel(duel, playerId, now);
  const seat = seatOf(d, playerId);
  if (seat < 0) return fail(403, "You're not in this duel.");
  const out = act(d, seat);
  return out.ok ? { ok: true, duel: advanceDuel(out.duel, now) } : out;
}

const notPlaying = (d: Duel) => fail(409, d.status === "lobby" ? "The duel hasn't started yet." : "This duel is over.");

export function readyDuel(duel: Duel, playerId: string, ready: boolean, now: number): DuelOutcome {
  return seated(duel, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The duel has already started.");
    d.players[seat].ready = ready;
    return { ok: true, duel: d };
  });
}

export function guessDuel(duel: Duel, playerId: string, index: number, pin: { x: number; y: number }, now: number): DuelOutcome {
  return seated(duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    const round = d.rounds[d.rounds.length - 1];
    if (index !== d.rounds.length - 1 || round.result) return fail(409, "That round is over.");
    if (now < round.startsAt) return fail(409, "The round hasn't started yet.");
    if (round.guesses[seat]) return fail(409, "You've already guessed this round.");
    round.guesses[seat] = { x: pin.x, y: pin.y, at: now };
    return { ok: true, duel: d };
  });
}

/** Next round, please: once both trainers press it, the reveal ends early. */
export function skipReveal(duel: Duel, playerId: string, index: number, now: number): DuelOutcome {
  return seated(duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    // The next round already began (the reveal ran out): nothing to skip.
    if (index < d.rounds.length - 1) return { ok: true, duel: d };
    const round = d.rounds[index];
    if (!round?.result) return fail(409, "That round isn't over yet.");
    round.skip[seat] = true;
    if (round.skip.every(Boolean)) round.result.nextAt = Math.min(round.result.nextAt, now);
    return { ok: true, duel: d };
  });
}

/** Leaving the lobby frees your seat; leaving mid-duel forfeits it. */
export function leaveDuel(duel: Duel, playerId: string, now: number): DuelOutcome {
  return seated(duel, playerId, now, (d, seat) => {
    if (d.status === "lobby") d.players.splice(seat, 1);
    else if (d.status === "playing") finish(d, "left", 1 - seat, now);
    return { ok: true, duel: d };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** A round's true place. Server-side only: it goes to the browser in the reveal and never before. */
export const roundAnswer = (duel: Duel, index: number) => answerFor(geoSpec(duel.region), duel.rounds[index].plan);

/** What one trainer (or a visitor: null) may see of the duel right now. */
export function duelView(duel: Duel, playerId: string | null, now: number, rev: number): DuelView {
  const seat = seatOf(duel, playerId);
  const revealed = duel.rounds.flatMap((r, index): DuelRoundResult[] => {
    if (!r.result) return [];
    const { scores, squares, damage, hurt, hp } = r.result;
    return [
      {
        index,
        multiplier: duelMultiplier(index),
        shot: shotUrl(r.plan),
        answer: roundAnswer(duel, index),
        guesses: r.guesses.map((g, k) => (g ? { x: g.x, y: g.y, score: scores[k], squares: squares[k] } : null)),
        damage,
        hurt,
        hp,
      },
    ];
  });
  const last = duel.rounds[duel.rounds.length - 1];
  const live = duel.status === "playing" && last && !last.result ? last : undefined;
  const mine = live && seat >= 0 ? live.guesses[seat] : null;
  return {
    code: duel.code,
    region: duel.region,
    status: duel.status,
    now,
    rev,
    you: seat >= 0 ? seat : null,
    players: duel.players.map((p) => ({ name: p.name, ready: p.ready, quiet: now - p.seenAt > DUEL_QUIET_MS })),
    hp: duel.hp,
    maxRounds: duel.maxRounds,
    round: live && {
      index: duel.rounds.length - 1,
      multiplier: duelMultiplier(duel.rounds.length - 1),
      startsAt: live.startsAt,
      shot: now >= live.startsAt ? shotUrl(live.plan) : undefined,
      endsAt: closesAt(live),
      countdown: live.guesses.some(Boolean),
      guessed: live.guesses.map(Boolean),
      yours: mine ? { x: mine.x, y: mine.y } : undefined,
    },
    revealed,
    next: duel.status === "playing" && last?.result ? { at: last.result.nextAt, pressed: last.skip } : undefined,
    end: duel.end,
    rematch: duel.rematch,
  };
}
