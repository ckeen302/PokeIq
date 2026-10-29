import "server-only";
import { randomInt } from "node:crypto";
import { randomId, signToken, verifyToken } from "./crypto";
import { emoteBlocked } from "./duel-core";
import { duelTable } from "./duel-store";
import { answerFor, isGeoSpec, measureGuess, planRounds } from "./geo";
import { EMOTE_WINDOW_MS, type DuelEmote, type PvpEmoteView } from "@/lib/pvp-types";
import { isTaunt, type TauntId } from "@/lib/trainer/taunts";
import { hpAfter, rampMultiplier } from "@/lib/geo-duel-rules";
import {
  PARTY_AWAY_MS,
  PARTY_CODE_ALPHABET,
  PARTY_CODE_RE,
  PARTY_FIRST_LEAD_MS,
  PARTY_GRACE_MS,
  PARTY_LEAD_MS,
  PARTY_MAX_PLAYERS,
  PARTY_QUIET_MS,
  PARTY_REVEAL_MS,
  PARTY_TEAM_HP,
  PARTY_TEAM_MAX,
  defaultPartySettings,
  livesAfter,
  royaleLosers,
  royalePlaces,
  teamRound,
  type PartyEnd,
  type PartyEndReason,
  type PartyRoundResult,
  type PartySettings,
  type PartyView,
  type TeamRound,
} from "@/lib/geo-party";
import type { DuelStatus } from "@/lib/duel-types";

/**
 * PokéGuessr parties (lib/geo-party.ts has the rules and the views): a room
 * of up to 16 trainers with a short code, a host who sets the game up and
 * starts it, and Battle Royale or team duel rounds on the duel engine's
 * pattern. A party is one record in the duels' store (the `geo_duels` table,
 * keyed by its six-letter code, which never clashes with a duel's eight),
 * changed only by compare-and-swap. Nothing runs on a timer: every poll or
 * action catches the party up, each step dated by the rules rather than by
 * when the request arrived. Rounds are sealed: the place goes to browsers
 * only in the reveal, and nobody sees another trainer's pin before it, but
 * for teammates in a team duel. All functions are pure (they take `now`).
 */

type PlannedRound = ReturnType<typeof planRounds>[number];

export interface PartyPlayer {
  id: string;
  name: string;
  /** The trainer's last request (to the nearest few seconds). */
  seenAt: number;
  team?: 0 | 1;
  /** Battle Royale lives left. */
  lives: number;
  /** The round (0-based) they went out in. */
  outRound?: number;
  /** Left (or was removed) during the game: out of it, kept so the rounds' seats line up. */
  left?: boolean;
}

interface Pin {
  x: number;
  y: number;
}

interface PartyRound {
  plan: PlannedRound;
  startsAt: number;
  /** Who plays the round (still in when it began). */
  playing: boolean[];
  guesses: ((Pin & { at: number }) | null)[];
  /** Team duels: where each trainer's pin sits before they lock it in (teammates see it). */
  aims?: (Pin | null)[];
  skip: boolean[];
  result?: {
    at: number;
    scores: number[];
    squares: number[];
    losers?: number[];
    out?: number[];
    lives?: number[];
    team?: TeamRound & { hpBefore: [number, number]; hp: [number, number] };
    nextAt: number;
  };
}

export interface GeoParty {
  v: 1;
  kind: "geo-party";
  code: string;
  /** Plans the game's rounds. Server-side only. */
  seed: string;
  createdAt: number;
  status: DuelStatus;
  hostId: string;
  /** Games started in this room. */
  game: number;
  settings: PartySettings;
  players: PartyPlayer[];
  /** Ids and lower-cased names the host removed: they can't come back in. */
  banned: string[];
  hp: [number, number];
  maxRounds: number;
  rounds: PartyRound[];
  end?: PartyEnd;
  emotes?: PvpEmoteView[];
  emoteCount?: number;
}

export type PartyFailure = { ok: false; status: number; error: string };
export type PartyOutcome = { ok: true; party: GeoParty } | PartyFailure;
const fail = (status: number, error: string): PartyFailure => ({ ok: false, status, error });

const SEEN_STEP_MS = 5_000;
const MAX_STEPS = 4 * 20 + 2 * PARTY_MAX_PLAYERS + 8;
const EMOTES_KEPT = 24;
/** Reactions and taunts stay in the view this long: a finished party polls slowly, and the pages play each one once (by its number). */
const EMOTE_KEEP_MS = 20_000;

// ---------------------------------------------------------------------------
// Storage and seats
// ---------------------------------------------------------------------------

/** Parties live with the duels (`geo_duels`): six-letter keys, so no duel route ever reads one. */
export const partyStore = duelTable<GeoParty>("geo_duels", "geo-party");

export function newPartyCode(): string {
  return Array.from({ length: 6 }, () => PARTY_CODE_ALPHABET[randomInt(PARTY_CODE_ALPHABET.length)]).join("");
}

/** A party for its page: null if there's no such party, undefined if the store couldn't say. */
export async function peekParty(code: string): Promise<GeoParty | null | undefined> {
  if (!PARTY_CODE_RE.test(code)) return null;
  try {
    const stored = await partyStore.load(code);
    return stored?.duel.kind === "geo-party" ? stored.duel : null;
  } catch (err) {
    console.error("[geo-party] read failed:", err);
    return undefined;
  }
}

/** A trainer's seat in one party (with their name, so a trainer dropped from the lobby can take it back). */
export const partyToken = (code: string, playerId: string, name: string) => signToken("geo-party", { d: code, p: playerId, n: name });

export function readPartyToken(token: unknown, code: string): { id: string; name: string } | null {
  const seat = verifyToken<{ d: string; p: string; n: string }>("geo-party", token);
  return seat && seat.d === code && typeof seat.p === "string" && typeof seat.n === "string" ? { id: seat.p, name: seat.n } : null;
}

// ---------------------------------------------------------------------------
// Maps and plans
// ---------------------------------------------------------------------------

const spec = (region: string) => ({ region, kind: "game" as const });
export const isPartyMap = (region: string) => isGeoSpec(spec(region));
const plan = (p: Pick<GeoParty, "settings" | "seed">, count: number) => planRounds({ region: p.settings.region, kind: "streak" }, p.seed, count);
const shotUrl = (round: PlannedRound) => `/api/geo/shot/${round.shot}`;

// ---------------------------------------------------------------------------
// Creating and joining
// ---------------------------------------------------------------------------

const seatOf = (p: GeoParty, id: string | null) => (id ? p.players.findIndex((x) => x.id === id) : -1);
const nameTaken = (p: GeoParty, name: string) => p.players.some((x) => x.name.toLowerCase() === name.toLowerCase());

export function createParty(code: string, name: string, region: string, now: number, mode: PartySettings["mode"] = "royale"): { party: GeoParty; playerId: string } {
  const id = randomId();
  const settings = defaultPartySettings(region, mode);
  return {
    playerId: id,
    party: {
      v: 1,
      kind: "geo-party",
      code,
      seed: randomId(),
      createdAt: now,
      status: "lobby",
      hostId: id,
      game: 0,
      settings,
      players: [{ id, name, seenAt: now, lives: settings.lives, ...(mode === "team" ? { team: 0 as const } : {}) }],
      banned: [],
      hp: [PARTY_TEAM_HP, PARTY_TEAM_HP],
      maxRounds: settings.rounds,
      rounds: [],
    },
  };
}

/** The team with fewer trainers (red on a tie). */
const lighterTeam = (p: GeoParty): 0 | 1 => (p.players.filter((x) => x.team === 1).length < p.players.filter((x) => x.team === 0).length ? 1 : 0);

/**
 * Taking a seat in the lobby: a new trainer (`id` null), or one coming back
 * with their seat token after the lobby dropped them (closed the tab for a
 * while). Removed trainers, a full room, a game under way and a name in use
 * all say no.
 */
export function joinParty(party: GeoParty, name: string, now: number, id: string | null = null): { ok: true; party: GeoParty; playerId: string } | PartyFailure {
  const p = advanceParty(party, now);
  if (id && seatOf(p, id) >= 0) return { ok: true, party: touchParty(p, id, now), playerId: id };
  if ((id && p.banned.includes(id)) || p.banned.includes(name.toLowerCase())) return fail(403, "The host removed you from this party.");
  if (p.status !== "lobby") return fail(409, "This party's game is under way. You can join when it's back in the lobby, or watch.");
  if (p.players.length >= PARTY_MAX_PLAYERS) return fail(409, `This party is full (${PARTY_MAX_PLAYERS} trainers).`);
  if (nameTaken(p, name)) return fail(409, `${name} is already in this party. Pick another name.`);
  const playerId = id ?? randomId();
  p.players.push({ id: playerId, name, seenAt: now, lives: p.settings.lives, ...(p.settings.mode === "team" ? { team: lighterTeam(p) } : {}) });
  if (!p.players.some((x) => x.id === p.hostId)) p.hostId = playerId;
  return { ok: true, party: p, playerId };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** A request from a trainer (or a visitor: null): marks them as here, then catches up. */
export function touchParty(party: GeoParty, playerId: string | null, now: number): GeoParty {
  const p = structuredClone(party);
  const me = p.players.find((x) => x.id === playerId);
  if (me && !me.left && p.status !== "finished" && now - me.seenAt >= SEEN_STEP_MS) me.seenAt = now;
  return advanceParty(p, now);
}

export function advanceParty(party: GeoParty, now: number): GeoParty {
  const p = structuredClone(party);
  for (let i = 0; i < MAX_STEPS && step(p, now); i++);
  return p;
}

/** The host: the first trainer still here if the host has gone. */
function fixHost(p: GeoParty) {
  const host = p.players.find((x) => x.id === p.hostId && !x.left);
  if (!host) {
    const next = p.players.find((x) => !x.left);
    if (next) p.hostId = next.id;
  }
}

/** Takes a trainer out of the game under way (left, removed or gone quiet). */
function dropOut(p: GeoParty, seat: number) {
  const x = p.players[seat];
  x.left = true;
  if (x.outRound === undefined && x.lives > 0) x.outRound = Math.max(0, p.rounds.length - 1);
  x.lives = 0;
  fixHost(p);
}

const inGame = (p: GeoParty, seat: number) => {
  const x = p.players[seat];
  return !x.left && (p.settings.mode === "team" || x.lives > 0);
};

function step(p: GeoParty, now: number): boolean {
  if (p.status === "finished") return false;
  if (p.status === "lobby") {
    const here = p.players.filter((x) => now - x.seenAt <= PARTY_AWAY_MS);
    if (here.length < p.players.length) {
      p.players = here;
      fixHost(p);
      return true;
    }
    return false;
  }

  // A trainer who stopped responding is out.
  const gone = p.players.findIndex((x) => !x.left && x.seenAt + PARTY_AWAY_MS < now);
  if (gone >= 0) {
    dropOut(p, gone);
    return true;
  }
  if (decideByDepartures(p, now)) return true;

  const round = p.rounds[p.rounds.length - 1];
  if (!round.result) {
    const close = closesAt(p, round);
    const seats = round.playing.flatMap((on, seat) => (on && !p.players[seat].left ? [seat] : []));
    const all = seats.length > 0 && seats.every((s) => round.guesses[s]);
    if (!all && now <= close + PARTY_GRACE_MS) return false;
    reveal(p, round, all ? Math.max(round.startsAt, ...seats.map((s) => round.guesses[s]!.at)) : close + PARTY_GRACE_MS);
    return true;
  }
  if (now < round.result.nextAt) return false;
  p.rounds.push(newRound(p, round.result.nextAt + PARTY_LEAD_MS));
  return true;
}

/** Everyone else left: the game is decided (a team with nobody left loses; the last royale trainer wins). */
function decideByDepartures(p: GeoParty, now: number): boolean {
  if (p.settings.mode === "team") {
    const sides = ([0, 1] as const).map((t) => p.players.some((x) => x.team === t && !x.left));
    if (sides[0] && sides[1]) return false;
    finish(p, "left", now, sides[0] ? 0 : sides[1] ? 1 : null);
    return true;
  }
  const alive = p.players.filter((x, seat) => inGame(p, seat));
  if (alive.length > 1) return false;
  finish(p, alive.length === 1 ? "last" : "left", now);
  return true;
}

function closesAt(p: GeoParty, round: PartyRound): number {
  const first = Math.min(...round.guesses.map((g) => g?.at ?? Infinity));
  const limit = round.startsAt + p.settings.roundSeconds * 1000;
  return Number.isFinite(first) ? Math.min(limit, first + p.settings.countdownSeconds * 1000) : limit;
}

function newRound(p: GeoParty, startsAt: number): PartyRound {
  const planned = plan(p, p.rounds.length + 1)[p.rounds.length];
  const n = p.players.length;
  return {
    plan: planned,
    startsAt,
    playing: p.players.map((_, seat) => inGame(p, seat)),
    guesses: Array(n).fill(null),
    ...(p.settings.mode === "team" ? { aims: Array(n).fill(null) } : {}),
    skip: Array(n).fill(false),
  };
}

const totalsOf = (p: GeoParty) => p.players.map((_, seat) => p.rounds.reduce((s, r) => s + (r.result?.scores[seat] ?? 0), 0));

function reveal(p: GeoParty, round: PartyRound, at: number) {
  const index = p.rounds.indexOf(round);
  const measured = round.guesses.map((g, seat) => (g && round.playing[seat] ? measureGuess(spec(p.settings.region), round.plan, g.x, g.y) : null));
  const scores = measured.map((m) => m?.score ?? 0);
  const squares = measured.map((m) => m?.squares ?? 0);
  const nextAt = at + PARTY_REVEAL_MS;
  if (p.settings.mode === "royale") {
    const alive = round.playing.map((on, seat) => on && !p.players[seat].left);
    const losers = royaleLosers(scores, alive);
    const lives = livesAfter(
      p.players.map((x) => x.lives),
      losers
    );
    const out: number[] = [];
    p.players.forEach((x, seat) => {
      x.lives = lives[seat];
      if (x.lives === 0 && x.outRound === undefined) {
        x.outRound = index;
        out.push(seat);
      }
    });
    round.result = { at, scores, squares, losers, out, lives, nextAt };
    const still = p.players.filter((_, seat) => inGame(p, seat)).length;
    if (still <= 1) finish(p, "last", at);
    else if (p.rounds.length >= p.maxRounds) finish(p, "rounds", at);
    return;
  }
  const teams = p.players.map((x, seat) => (round.playing[seat] && x.team !== undefined ? x.team : null));
  const t = teamRound(scores, teams, index);
  const hpBefore: [number, number] = [p.hp[0], p.hp[1]];
  const hp = hpAfter(p.hp, t.hurt, t.damage) as [number, number];
  p.hp = hp;
  round.result = { at, scores, squares, team: { ...t, hpBefore, hp }, nextAt };
  if (hp.some((h) => h <= 0)) finish(p, "hp", at, hp[0] > 0 ? 0 : 1);
  else if (p.rounds.length >= p.maxRounds) finish(p, "rounds", at, hp[0] === hp[1] ? null : hp[0] > hp[1] ? 0 : 1);
}

function finish(p: GeoParty, reason: PartyEndReason, at: number, team?: 0 | 1 | null) {
  p.status = "finished";
  const totals = totalsOf(p);
  if (p.settings.mode === "team") {
    const places = p.players.map((x) => (team === null || team === undefined || x.team === team ? 1 : 2));
    p.end = { reason, at, team: team ?? null, winners: places.flatMap((pl, seat) => (pl === 1 && team !== null && team !== undefined ? [seat] : [])), places };
    return;
  }
  const places = royalePlaces(p.players.map((x, seat) => ({ lives: x.lives, outRound: x.outRound, points: totals[seat] })));
  p.end = { reason, at, winners: places.flatMap((pl, seat) => (pl === 1 && !p.players[seat].left ? [seat] : [])), places };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function seated(party: GeoParty, playerId: string, now: number, act: (p: GeoParty, seat: number) => PartyOutcome): PartyOutcome {
  const p = touchParty(party, playerId, now);
  const seat = seatOf(p, playerId);
  if (seat < 0) return fail(403, "You're not in this party.");
  const out = act(p, seat);
  return out.ok ? { ok: true, party: advanceParty(out.party, now) } : out;
}

function hosted(party: GeoParty, playerId: string, now: number, act: (p: GeoParty, seat: number) => PartyOutcome): PartyOutcome {
  return seated(party, playerId, now, (p, seat) => (p.hostId === playerId ? act(p, seat) : fail(403, "Only the host can do that.")));
}

/** The host changes the game (lobby only). The map is checked by the caller. */
export function setPartySettings(party: GeoParty, playerId: string, settings: PartySettings, now: number): PartyOutcome {
  return hosted(party, playerId, now, (p) => {
    if (p.status !== "lobby") return fail(409, "Change the game in the lobby.");
    const switched = settings.mode !== p.settings.mode;
    p.settings = settings;
    p.maxRounds = settings.rounds;
    p.players.forEach((x) => (x.lives = settings.lives));
    if (switched && settings.mode === "team") {
      // Deal everyone onto teams, alternately.
      p.players.forEach((x, i) => (x.team = (i % 2) as 0 | 1));
    }
    if (settings.mode === "royale") p.players.forEach((x) => delete x.team);
    return { ok: true, party: p };
  });
}

/** Team duels: switch team (yourself; the host can move anyone). */
export function setTeam(party: GeoParty, playerId: string, target: number | undefined, team: 0 | 1, now: number): PartyOutcome {
  return seated(party, playerId, now, (p, seat) => {
    if (p.status !== "lobby") return fail(409, "Teams are picked in the lobby.");
    if (p.settings.mode !== "team") return fail(409, "Teams are for team duels.");
    const who = target ?? seat;
    if (who !== seat && p.hostId !== playerId) return fail(403, "Only the host can move other trainers.");
    if (!p.players[who]) return fail(404, "No such trainer.");
    if (p.players[who].team !== team && p.players.filter((x) => x.team === team).length >= PARTY_TEAM_MAX) return fail(409, `A team has at most ${PARTY_TEAM_MAX} trainers.`);
    p.players[who].team = team;
    return { ok: true, party: p };
  });
}

/** Why the host can't start yet, or null. */
export function startBlocked(p: Pick<GeoParty, "players" | "settings">): string | null {
  if (p.settings.mode === "team") {
    const sizes = [0, 1].map((t) => p.players.filter((x) => x.team === t).length);
    if (sizes.some((n) => n === 0)) return "Each team needs at least one trainer.";
    if (sizes.some((n) => n > PARTY_TEAM_MAX)) return `A team has at most ${PARTY_TEAM_MAX} trainers.`;
    return null;
  }
  return p.players.length < 2 ? "A Battle Royale needs at least two trainers." : null;
}

export function startParty(party: GeoParty, playerId: string, now: number): PartyOutcome {
  return hosted(party, playerId, now, (p) => {
    if (p.status !== "lobby") return fail(409, "The game has already started.");
    const blocked = startBlocked(p);
    if (blocked) return fail(409, blocked);
    p.status = "playing";
    p.game += 1;
    p.maxRounds = plan(p, p.settings.rounds).length;
    p.hp = [PARTY_TEAM_HP, PARTY_TEAM_HP];
    p.players.forEach((x) => {
      x.lives = p.settings.lives;
      delete x.outRound;
      delete x.left;
    });
    p.rounds = [newRound(p, now + PARTY_FIRST_LEAD_MS)];
    return { ok: true, party: p };
  });
}

export function kickPlayer(party: GeoParty, playerId: string, target: number, now: number): PartyOutcome {
  return hosted(party, playerId, now, (p, seat) => {
    const x = p.players[target];
    if (!x || target === seat) return fail(409, "Pick another trainer.");
    p.banned = [...p.banned, x.id, x.name.toLowerCase()].slice(-64);
    if (p.status === "lobby") p.players.splice(target, 1);
    else if (!x.left) dropOut(p, target);
    return { ok: true, party: p };
  });
}

export function guessParty(party: GeoParty, playerId: string, index: number, pin: Pin, now: number): PartyOutcome {
  return seated(party, playerId, now, (p, seat) => {
    if (p.status !== "playing") return fail(409, p.status === "lobby" ? "The game hasn't started yet." : "This game is over.");
    const round = p.rounds[p.rounds.length - 1];
    if (index !== p.rounds.length - 1 || round.result) return fail(409, "That round is over.");
    if (now < round.startsAt) return fail(409, "The round hasn't started yet.");
    if (!round.playing[seat] || p.players[seat].left) return fail(409, "You're watching this round.");
    if (round.guesses[seat]) return fail(409, "You've already guessed this round.");
    round.guesses[seat] = { x: pin.x, y: pin.y, at: now };
    if (round.aims) round.aims[seat] = null;
    return { ok: true, party: p };
  });
}

/** Team duels: where your pin sits before you lock it in, for your teammates' maps. */
export function aimParty(party: GeoParty, playerId: string, index: number, pin: Pin, now: number): PartyOutcome {
  return seated(party, playerId, now, (p, seat) => {
    const round = p.rounds[p.rounds.length - 1];
    if (p.status !== "playing" || !round?.aims || index !== p.rounds.length - 1 || round.result || now < round.startsAt) return { ok: true, party: p };
    if (!round.playing[seat] || round.guesses[seat]) return { ok: true, party: p };
    round.aims[seat] = { x: pin.x, y: pin.y };
    return { ok: true, party: p };
  });
}

/** Next round, please: once everyone still in presses it, the reveal ends early. */
export function skipPartyReveal(party: GeoParty, playerId: string, index: number, now: number): PartyOutcome {
  return seated(party, playerId, now, (p, seat) => {
    if (p.status !== "playing") return { ok: true, party: p };
    if (index < p.rounds.length - 1) return { ok: true, party: p };
    const round = p.rounds[index];
    if (!round?.result) return fail(409, "That round isn't over yet.");
    round.skip[seat] = true;
    const waiting = p.players.flatMap((_, s) => (inGame(p, s) ? [s] : []));
    if (waiting.every((s) => round.skip[s])) round.result.nextAt = Math.min(round.result.nextAt, now);
    return { ok: true, party: p };
  });
}

/** Leaving the lobby frees your seat; leaving a game takes you out of it. */
export function leaveParty(party: GeoParty, playerId: string, now: number): PartyOutcome {
  return seated(party, playerId, now, (p, seat) => {
    if (p.status === "playing") dropOut(p, seat);
    else {
      p.players.splice(seat, 1);
      fixHost(p);
    }
    return { ok: true, party: p };
  });
}

/** The host takes the room back to the lobby for another game: same trainers (those still here), new places. */
export function partyAgain(party: GeoParty, playerId: string, now: number): PartyOutcome {
  return hosted(party, playerId, now, (p) => {
    if (p.status !== "finished") return fail(409, "The game isn't over yet.");
    p.status = "lobby";
    p.seed = randomId();
    p.rounds = [];
    p.hp = [PARTY_TEAM_HP, PARTY_TEAM_HP];
    delete p.end;
    p.emotes = [];
    p.players = p.players
      .filter((x) => !x.left)
      .map((x) => ({ id: x.id, name: x.name, seenAt: Math.max(x.seenAt, now - PARTY_AWAY_MS / 2), lives: p.settings.lives, ...(x.team !== undefined ? { team: x.team } : {}) }));
    fixHost(p);
    return { ok: true, party: p };
  });
}

/** A preset reaction during play or after the end; taunts (dances and emotes on the 3D trainer) only after the end. */
export function emoteParty(party: GeoParty, playerId: string, emote: DuelEmote | TauntId, now: number): PartyOutcome {
  return seated(party, playerId, now, (p, seat) => {
    if (p.status === "lobby") return fail(409, "Reactions open once the game starts.");
    if (isTaunt(emote) && p.status !== "finished") return fail(409, "Dances and emotes open once the game is over.");
    const emotes = (p.emotes ?? []).filter((e) => now - e.at < Math.max(EMOTE_WINDOW_MS, EMOTE_KEEP_MS));
    const blocked = emoteBlocked(emotes, seat, now, emote);
    if (blocked) return fail(429, blocked);
    const n = (p.emoteCount ?? 0) + 1;
    p.emotes = [...emotes, { n, seat, emote, at: now }].slice(-EMOTES_KEPT);
    p.emoteCount = n;
    return { ok: true, party: p };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** A round's true place. Server-side only: it goes to browsers in the reveal and never before. */
export const partyRoundAnswer = (p: GeoParty, index: number) => answerFor(spec(p.settings.region), p.rounds[index].plan);

/** What one trainer (or a visitor: null) may see of the party right now. */
export function partyView(p: GeoParty, playerId: string | null, now: number, rev: number): PartyView {
  const seat = seatOf(p, playerId);
  const team = p.settings.mode === "team";
  const revealed = p.rounds.flatMap((r, index): PartyRoundResult[] => {
    if (!r.result) return [];
    const { scores, squares } = r.result;
    return [
      {
        index,
        shot: shotUrl(r.plan),
        answer: answerFor(spec(p.settings.region), r.plan),
        playing: r.playing,
        guesses: r.guesses.map((g, k) => (g && r.playing[k] ? { x: g.x, y: g.y, score: scores[k], squares: squares[k] } : null)),
        ...(r.result.losers ? { losers: r.result.losers, out: r.result.out ?? [], lives: r.result.lives ?? [] } : {}),
        ...(r.result.team ? { team: r.result.team } : {}),
      },
    ];
  });
  const last = p.rounds[p.rounds.length - 1];
  const live = p.status === "playing" && last && !last.result ? last : undefined;
  const mine = live && seat >= 0 ? live.guesses[seat] : null;
  const myTeam = seat >= 0 ? p.players[seat].team : undefined;
  return {
    kind: "geo-party",
    code: p.code,
    status: p.status,
    now,
    rev,
    you: seat >= 0 ? seat : null,
    host: Math.max(0, p.players.findIndex((x) => x.id === p.hostId)),
    game: p.game,
    settings: p.settings,
    players: p.players.map((x, k) => ({
      name: x.name,
      ready: true,
      quiet: !x.left && now - x.seenAt > PARTY_QUIET_MS,
      ...(x.team !== undefined ? { team: x.team } : {}),
      ...(team ? {} : { lives: x.lives }),
      ...(p.status !== "lobby" && !inGame(p, k) ? { out: true } : {}),
      ...(x.left ? { left: true } : {}),
    })),
    ...(team ? { hp: p.hp } : {}),
    maxRounds: p.maxRounds,
    round: live && {
      index: p.rounds.length - 1,
      multiplier: team ? rampMultiplier(p.rounds.length - 1) : 1,
      startsAt: live.startsAt,
      shot: now >= live.startsAt ? shotUrl(live.plan) : undefined,
      endsAt: closesAt(p, live),
      countdown: live.guesses.some(Boolean),
      guessed: live.guesses.map(Boolean),
      playing: live.playing.map((on, k) => on && !p.players[k].left),
      yours: mine ? { x: mine.x, y: mine.y } : undefined,
      // Teammates' pins, live: the other team's never before the reveal.
      ...(team && myTeam !== undefined
        ? {
            mates: p.players.map((x, k) => {
              if (k === seat || x.team !== myTeam || !live.playing[k]) return null;
              const g = live.guesses[k];
              if (g) return { x: g.x, y: g.y, locked: true };
              const a = live.aims?.[k];
              return a ? { x: a.x, y: a.y, locked: false } : null;
            }),
          }
        : {}),
    },
    revealed,
    next: p.status === "playing" && last?.result ? { at: last.result.nextAt, pressed: last.skip } : undefined,
    end: p.end,
    totals: totalsOf(p),
    emotes: (p.emotes ?? []).filter((e) => now - e.at < EMOTE_KEEP_MS),
  };
}
