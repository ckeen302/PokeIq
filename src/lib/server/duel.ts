import "server-only";
import { randomId } from "./crypto";
import { chatClosed, duelNameSchema, emoteBlocked, readSeatToken, seatToken } from "./duel-core";
import { postChat, systemLine } from "./chat";
import type { ChatLine } from "@/lib/chat";
import { EMOTE_SHOW_MS, EMOTE_WINDOW_MS, type DuelEmote, type PvpEmoteView } from "@/lib/pvp-types";
import { answerFor, isGeoSpec, measureGuess, planRounds } from "./geo";
import {
  DUEL_AWAY_MS,
  DUEL_COUNTDOWN_MS,
  DUEL_HP,
  DUEL_IDLE_ROUNDS,
  DUEL_LEAD_MS,
  DUEL_MAX_ROUNDS,
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
import type { GeoSpec } from "@/lib/geo-types";

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
  /** Recent reactions, and how many the duel has had. */
  emotes?: PvpEmoteView[];
  emoteCount?: number;
  /** Chat in the lobby and after the end. */
  chat?: ChatLine[];
}

export type DuelFailure = { ok: false; status: number; error: string };
export type DuelOutcome = { ok: true; duel: Duel } | DuelFailure;

const fail = (status: number, error: string): DuelFailure => ({ ok: false, status, error });
/** Reactions kept on the duel: enough to judge the rate limit and show the latest. */
const EMOTES_KEPT = 12;
/** Heartbeats move `seenAt` on in steps this big, so polling doesn't write every second. */
const SEEN_STEP_MS = 5_000;
/** A guess sent just before the bell still counts if it arrives within this long after it. */
const GRACE_MS = 1_000;
/** Enough steps to catch up on any duel (each round has at most a reveal and a start). */
const MAX_STEPS = 4 * DUEL_MAX_ROUNDS + 8;

export { duelNameSchema };

/** A duel's map as the single-player engine sees it, for scoring pins and naming places. */
const geoSpec = (region: string): GeoSpec => ({ region, kind: "game" });

/**
 * A duel's places: the first `count` of a streak's rounds from the duel's seed
 * (a five-round game's plan stops at five). Every town, route and landmark is
 * equally likely and no two rounds share a town; one seed, so both trainers
 * get the same places.
 */
const planDuel = (region: string, seed: string, count: number) => planRounds({ region, kind: "streak" }, seed, count);

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
  return seatToken("geo-duel", code, playerId);
}

export function readDuelToken(token: unknown, code: string): string | null {
  return readSeatToken("geo-duel", token, code);
}

// ---------------------------------------------------------------------------
// Creating and joining
// ---------------------------------------------------------------------------

function blankDuel(region: string, code: string, players: DuelPlayer[], now: number, seed = randomId()): Duel {
  const maxRounds = planDuel(region, seed, DUEL_MAX_ROUNDS).length;
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
  d.chat = systemLine(d.chat, `${name} joined`, now);
  return { ok: true, duel: d, playerId };
}

/** A rematch: the same map and trainers (same seats), new places, the chat so far. Both start un-ready, as if just seen. */
export function rematchOf(old: Duel, code: string, now: number, seed?: string): Duel {
  const next = blankDuel(old.region, code, old.players.map((p) => ({ id: p.id, name: p.name, ready: false, seenAt: now })), now, seed);
  return old.chat?.length ? { ...next, chat: old.chat } : next;
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
  // After the end nobody can time out, so polls there (waiting for a rematch) write nothing.
  if (player && d.status !== "finished" && now - player.seenAt >= SEEN_STEP_MS) player.seenAt = now;
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
  const plan = planDuel(d.region, d.seed, d.rounds.length + 1)[d.rounds.length];
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
  d.chat = systemLine(d.chat, "GG!", at);
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

/** A preset reaction to the opponent: during play or after the end, a few at a time (as in the other duels). */
export function emoteDuel(duel: Duel, playerId: string, emote: DuelEmote, now: number): DuelOutcome {
  return seated(duel, playerId, now, (d, seat) => {
    if (d.status === "lobby" || d.players.length < 2) return fail(409, "Reactions open once the duel starts.");
    const emotes = (d.emotes ?? []).filter((e) => now - e.at < Math.max(EMOTE_WINDOW_MS, EMOTE_SHOW_MS));
    const blocked = emoteBlocked(emotes, seat, now);
    if (blocked) return fail(429, blocked);
    const n = (d.emoteCount ?? 0) + 1;
    d.emotes = [...emotes, { n, seat, emote, at: now }].slice(-EMOTES_KEPT);
    d.emoteCount = n;
    return { ok: true, duel: d };
  });
}

/** A seated trainer's chat message, in the lobby or after the end. */
export function chatDuel(duel: Duel, playerId: string, text: string, now: number): DuelOutcome {
  return seated(duel, playerId, now, (d, seat) => {
    const closed = chatClosed(d.status, d.rematch);
    if (closed) return fail(409, closed);
    const out = postChat(d.chat, seat, d.players[seat].name, text, now);
    if (!out.ok) return out;
    d.chat = out.chat;
    return { ok: true, duel: d };
  });
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
    emotes: (duel.emotes ?? []).filter((e) => now - e.at < EMOTE_SHOW_MS),
    ...(duel.chat?.length ? { chat: duel.chat } : {}),
  };
}
