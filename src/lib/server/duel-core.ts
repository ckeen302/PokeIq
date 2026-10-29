import "server-only";
import { TAUNT_GAP_MS, isTaunt } from "@/lib/trainer/taunts";
import { z } from "zod";
import { randomId, signToken, verifyToken } from "./crypto";
import { DUEL_NAME_RE, type DuelPlayerView, type DuelStatus } from "@/lib/duel-types";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import {
  PVP_AWAY_MS,
  PVP_LEAD_MS,
  PVP_QUIET_MS,
  PVP_SERIES_WINS,
  EMOTE_BURST,
  EMOTE_GAP_MS,
  EMOTE_SHOW_MS,
  EMOTE_WINDOW_MS,
  type DuelEmote,
  type PvpEmoteView,
  type PvpEnd,
  type PvpEndReason,
  type PvpKind,
  type PvpSeriesView,
} from "@/lib/pvp-types";
import type { ChatLine } from "@/lib/chat";
import { postChat, systemLine } from "./chat";

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
  /** A rematch's series so far: the games before this one. */
  series?: PvpSeries;
  /** Recent reactions (see emotePvp), and how many the duel has had. */
  emotes?: PvpEmoteView[];
  emoteCount?: number;
  /** Chat in the lobby and after the end (the last few dozen lines; a rematch carries them on). */
  chat?: ChatLine[];
}

/** Where a best-of-three series stands before a game, by trainer (seats can swap when a rematch lobby is retaken). */
export interface PvpSeries {
  /** The two trainers' ids, in the order `wins` counts them. */
  ids: string[];
  wins: number[];
  draws: number;
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
  d.chat = systemLine(d.chat, "GG!", at);
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
    series: seriesView(duel),
    emotes: (duel.emotes ?? []).filter((e) => now - e.at < EMOTE_SHOW_MS),
    ...(duel.chat?.length ? { chat: duel.chat } : {}),
  };
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

const sameTrainers = (a: readonly string[], b: readonly string[]) => a.length === 2 && b.length === 2 && a.every((id) => b.includes(id));
const seriesDecided = (s: PvpSeries) => s.wins.some((w) => w >= PVP_SERIES_WINS);

/** The series this duel's two trainers carry into it: the stored one if it's theirs and still open, else a new one. */
function seriesBefore(duel: PvpBase): PvpSeries | null {
  if (duel.players.length !== 2) return null;
  const ids = duel.players.map((p) => p.id);
  const s = duel.series;
  return s && sameTrainers(s.ids, ids) && !seriesDecided(s) ? s : { ids, wins: [0, 0], draws: 0 };
}

/** The series with this duel counted, once it's over. */
function seriesCounted(duel: PvpBase): PvpSeries | null {
  const s = seriesBefore(duel);
  if (!s || duel.status !== "finished" || !duel.end) return s;
  const winner = duel.end.winner;
  if (winner === null) return { ...s, draws: s.draws + 1 };
  const at = s.ids.indexOf(duel.players[winner].id);
  return { ...s, wins: s.wins.map((w, k) => (k === at ? w + 1 : w)) };
}

/** The series as the duel's seats see it (absent until both seats are filled). */
export function seriesView(duel: PvpBase): PvpSeriesView | undefined {
  const before = seriesBefore(duel);
  const after = seriesCounted(duel);
  if (!before || !after) return undefined;
  const wins = duel.players.map((p) => after.wins[after.ids.indexOf(p.id)]);
  const winner = wins.findIndex((w) => w >= PVP_SERIES_WINS);
  return {
    game: before.wins[0] + before.wins[1] + before.draws + 1,
    wins,
    draws: after.draws,
    winner: winner >= 0 ? winner : null,
  };
}

/** What a rematch of `old` carries on: the series with `old` counted, or nothing once someone has taken it (a new series). */
export function seriesForRematch(old: PvpBase): PvpSeries | undefined {
  const s = seriesCounted(old);
  return s && !seriesDecided(s) ? s : undefined;
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
  d.chat = systemLine(d.chat, `${name} joined`, now);
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

/**
 * A rematch: the same game and trainers (same seats), a new seed, and the
 * series so far. Both start un-ready, as if just seen.
 */
export function rematchPvp<D extends PvpBase>(rules: PvpRules<D>, old: D, code: string, now: number, seed?: string): D {
  const players = old.players.map((p) => ({ id: p.id, name: p.name, ready: false, seenAt: now }));
  const next = rules.blank(pvpBase(old.kind, code, players, now, seed), old);
  const series = seriesForRematch(old);
  const carried = old.chat?.length ? { ...next, chat: old.chat } : next;
  return series ? { ...carried, series } : carried;
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

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/** Why chat is closed on a duel right now, or null if it's open: in the lobby and after the end, until a rematch opens. */
export function chatClosed(status: DuelStatus, rematch: string | undefined): string | null {
  if (status === "playing") return "Chat opens again after the duel. Send a reaction instead!";
  if (rematch) return "The chat moved to the rematch lobby: press Rematch to keep chatting.";
  return null;
}

/** A seated trainer's chat message (checked and masked in chat.ts), in the lobby or after the end. */
export function chatPvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, playerId: string, text: string, now: number): PvpOutcome<D> {
  return seated(rules, duel, playerId, now, (d, seat) => {
    const closed = chatClosed(d.status, d.rematch);
    if (closed) return fail(409, closed);
    const out = postChat(d.chat, seat, d.players[seat].name, text, now);
    if (!out.ok) return out;
    d.chat = out.chat;
    return { ok: true, duel: d };
  });
}

/** Reactions kept on the duel: enough to judge the rate limit and show the latest. */
const EMOTES_KEPT = 12;

/** Why `seat` can't send a reaction at `now` (too many, too fast), or null if it can. */
export function emoteBlocked(emotes: readonly PvpEmoteView[], seat: number, now: number, emote?: string): string | null {
  const mine = emotes.filter((e) => e.seat === seat);
  const last = mine[mine.length - 1];
  if (last && now - last.at < EMOTE_GAP_MS) return "One reaction at a time.";
  // Taunts (post-game dances and emotes) take a few seconds each: one at a time.
  if (emote && isTaunt(emote)) {
    const lastTaunt = mine.filter((e) => isTaunt(e.emote)).pop();
    if (lastTaunt && now - lastTaunt.at < TAUNT_GAP_MS) return "One move at a time.";
  }
  if (mine.filter((e) => now - e.at < EMOTE_WINDOW_MS).length >= EMOTE_BURST) return "Easy on the reactions.";
  return null;
}

/** A preset reaction to the opponent: during play or after the end, a few at a time. */
export function emotePvp<D extends PvpBase>(rules: PvpRules<D>, duel: D, playerId: string, emote: DuelEmote, now: number): PvpOutcome<D> {
  return seated(rules, duel, playerId, now, (d, seat) => {
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
