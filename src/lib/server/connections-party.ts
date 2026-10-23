import "server-only";
import { generatePuzzle, playGuesses, type Puzzle } from "@/lib/connections/generator";
import { CONN_GROUP_SIZE, guessKey, type ConnLevel } from "@/lib/connections/types";
import { PARTY_MAX, PARTY_MIN, PARTY_MS, type PartyStanding, type PartyView } from "@/lib/connections/party";
import { PVP_AWAY_MS, PVP_LEAD_MS } from "@/lib/pvp-types";
import type { DuelStatus } from "@/lib/duel-types";
import { connTile, explainGroup, groupReveal } from "./connections";
import { raceRank, seatRace, type SeatRace } from "./connections-duel";
import { duelTable } from "./duel-store";
import { fail, type PvpFailure } from "./duel-core";
import { randomId } from "./crypto";

/**
 * PokéConnections party mode: 2 to 8 trainers race one puzzle from a share
 * link. The race is the duel's (a solve's time plus a penalty per mistake,
 * four mistakes and you're out; seatRace and raceRank are shared), but with
 * any number of racers: placings are ranked by the same rule, with the
 * earlier last guess winning a tie.
 *
 * Every guess is checked here. The placings are counts (groups found,
 * mistakes), never which tiles; a trainer sees only the groups they found
 * themselves until the party ends, when all four are explained.
 *
 * The host (the first seat) starts the race once everyone else has readied
 * up. Nothing runs on a timer: each request catches the party up.
 */

export interface PartyGuess {
  ids: number[];
  at: number;
}

export interface PartyPlayer {
  id: string;
  name: string;
  ready: boolean;
  seenAt: number;
  /** Left the party during the race. */
  left?: boolean;
}

export interface ConnectionsParty {
  v: 1;
  code: string;
  /** Plans the puzzle. Server-side only. */
  seed: string;
  createdAt: number;
  status: DuelStatus;
  /** The host is seat 0. */
  players: PartyPlayer[];
  startsAt?: number;
  /** One per seat once the race begins: every guess, oldest first (repeats are never stored). */
  boards: { guesses: PartyGuess[] }[];
  end?: { at: number; winner: number | null };
}

/** Parties are kept like duels (a few hours), in their own table, or in memory without Supabase. */
export const partyStore = duelTable<ConnectionsParty>("connections_parties", "party");

const SEEN_STEP_MS = 5_000;
/** Not heard from for this long: shown as away. */
export const PARTY_AWAY_SHOWN_MS = 12_000;

// ---------------------------------------------------------------------------
// The puzzle
// ---------------------------------------------------------------------------

const puzzles = new Map<string, Puzzle>();

/** The party's puzzle: the practice generator, seeded by the party (its own `party:` seeds, server-side only). */
export function partyPuzzle(p: Pick<ConnectionsParty, "seed">): Puzzle {
  let puzzle = puzzles.get(p.seed);
  if (!puzzle) {
    puzzle = generatePuzzle(`party:${p.seed}`);
    if (puzzles.size > 200) puzzles.clear();
    puzzles.set(p.seed, puzzle);
  }
  return puzzle;
}

// ---------------------------------------------------------------------------
// Placings
// ---------------------------------------------------------------------------

const gone = (p: PartyPlayer, now: number) => !!p.left || now - p.seenAt > PVP_AWAY_MS;

export const partyRaces = (d: ConnectionsParty, puzzle: Puzzle): SeatRace[] => d.players.map((_, seat) => seatRace(d, puzzle, seat));

/** Seats best first: a solve beats no solve (lower score first), then more groups, then fewer mistakes, then the earlier last guess. */
export function rankSeats(races: readonly SeatRace[]): number[] {
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return (b[i] ?? 0) - (a[i] ?? 0);
    return 0;
  };
  return races
    .map((r, seat) => ({ seat, key: raceRank(r), lastAt: r.lastAt }))
    .sort((a, b) => cmp(a.key, b.key) || a.lastAt - b.lastAt || a.seat - b.seat)
    .map((x) => x.seat);
}

export function partyStandings(d: ConnectionsParty, races: readonly SeatRace[], now: number): PartyStanding[] {
  const start = d.startsAt ?? 0;
  return rankSeats(races).map((seat, i) => {
    const r = races[seat];
    return {
      seat,
      name: d.players[seat].name,
      place: i + 1,
      found: r.found.length,
      mistakes: r.mistakes,
      solved: r.won,
      out: r.out || (d.status === "playing" ? gone(d.players[seat], now) : !!d.players[seat].left),
      ...(r.doneAt !== undefined && r.won && { ms: r.doneAt - start }),
      ...(r.score !== undefined && { score: r.score }),
    };
  });
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

function finishParty(d: ConnectionsParty, races: SeatRace[], at: number) {
  const [first] = rankSeats(races);
  d.status = "finished";
  d.end = { at, winner: first !== undefined && races[first].found.length > 0 ? first : null };
}

/** Applies what is due by `now`: trainers who walked out of the lobby, and the end of the race. */
export function advanceParty(party: ConnectionsParty, now: number): ConnectionsParty {
  const d = structuredClone(party);
  if (d.status === "lobby") {
    const here = d.players.filter((p) => now - p.seenAt <= PVP_AWAY_MS);
    if (here.length < d.players.length) d.players = here;
    return d;
  }
  if (d.status !== "playing" || d.startsAt === undefined) return d;
  const puzzle = partyPuzzle(d);
  const races = partyRaces(d, puzzle);
  if (now >= d.startsAt + PARTY_MS) {
    finishParty(d, races, d.startsAt + PARTY_MS);
  } else if (d.players.every((p, seat) => races[seat].over || gone(p, now))) {
    const times = d.players.map((p, seat) => (races[seat].over ? races[seat].doneAt! : p.left ? p.seenAt : p.seenAt + PVP_AWAY_MS));
    finishParty(d, races, Math.min(now, Math.max(d.startsAt, ...times)));
  }
  return d;
}

/** A request from a trainer (or a visitor: null): marks them as here, then catches up. */
export function touchParty(party: ConnectionsParty, playerId: string | null, now: number): ConnectionsParty {
  const d = structuredClone(party);
  const player = d.players.find((p) => p.id === playerId);
  if (player && d.status !== "finished" && now - player.seenAt >= SEEN_STEP_MS) player.seenAt = now;
  return advanceParty(d, now);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type PartyOutcome = { ok: true; party: ConnectionsParty } | PvpFailure;

const seatOfParty = (d: ConnectionsParty, playerId: string) => d.players.findIndex((p) => p.id === playerId);

export function createParty(name: string, code: string, now: number, seed = randomId()): { party: ConnectionsParty; playerId: string } {
  const host: PartyPlayer = { id: randomId(), name, ready: true, seenAt: now };
  return { party: { v: 1, code, seed, createdAt: now, status: "lobby", players: [host], boards: [] }, playerId: host.id };
}

export function joinParty(party: ConnectionsParty, name: string, now: number): { ok: true; party: ConnectionsParty; playerId: string } | PvpFailure {
  const d = advanceParty(party, now);
  if (d.status !== "lobby") return fail(409, "This party has already started.");
  if (d.players.length >= PARTY_MAX) return fail(409, `This party is full (${PARTY_MAX} players).`);
  if (d.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return fail(409, `${name} is already in this party. Pick another name.`);
  const player: PartyPlayer = { id: randomId(), name, ready: false, seenAt: now };
  d.players.push(player);
  return { ok: true, party: d, playerId: player.id };
}

function seated(party: ConnectionsParty, playerId: string, now: number, act: (d: ConnectionsParty, seat: number) => PartyOutcome): PartyOutcome {
  const d = touchParty(party, playerId, now);
  const seat = seatOfParty(d, playerId);
  if (seat < 0) return fail(403, "You're not in this party.");
  return act(d, seat);
}

export function readyParty(party: ConnectionsParty, playerId: string, ready: boolean, now: number): PartyOutcome {
  return seated(party, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The race has already started.");
    d.players[seat].ready = ready;
    return { ok: true, party: d };
  });
}

/** The host starts the race: two or more trainers, everyone else ready. It begins after the usual lead-in. */
export function startParty(party: ConnectionsParty, playerId: string, now: number): PartyOutcome {
  return seated(party, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The race has already started.");
    if (seat !== 0) return fail(403, "Only the host starts the race.");
    if (d.players.length < PARTY_MIN) return fail(409, `Wait for at least ${PARTY_MIN} players.`);
    const waiting = d.players.filter((p, i) => i !== 0 && !p.ready);
    if (waiting.length) return fail(409, `Waiting for ${waiting.map((p) => p.name).join(", ")} to ready up.`);
    d.status = "playing";
    d.startsAt = now + PVP_LEAD_MS;
    d.boards = d.players.map(() => ({ guesses: [] }));
    return { ok: true, party: d };
  });
}

/** Leaves the lobby (the next trainer becomes host) or, mid-race, drops out. */
export function leaveParty(party: ConnectionsParty, playerId: string, now: number): PartyOutcome {
  return seated(party, playerId, now, (d, seat) => {
    if (d.status === "finished") return { ok: true, party: d };
    if (d.status === "lobby") {
      d.players.splice(seat, 1);
      return { ok: true, party: d };
    }
    d.players[seat].left = true;
    d.players[seat].seenAt = now;
    return { ok: true, party: advanceParty(d, now) };
  });
}

/** A group of four, checked on the server: right, one away, or wrong (a mistake). */
export function guessParty(party: ConnectionsParty, playerId: string, ids: number[], now: number): PartyOutcome {
  return seated(party, playerId, now, (d, seat) => {
    if (d.status !== "playing") return fail(409, d.status === "lobby" ? "The race hasn't started yet." : "This party is over.");
    if (d.startsAt === undefined || now < d.startsAt) return fail(409, "The race hasn't started yet.");
    const puzzle = partyPuzzle(d);
    const race = seatRace(d, puzzle, seat);
    if (race.over) return fail(409, race.won ? "You've found every group: waiting for the others." : "You're out of mistakes: waiting for the others.");
    if (ids.length !== CONN_GROUP_SIZE || new Set(ids).size !== CONN_GROUP_SIZE) return fail(400, "Pick four different tiles.");
    const board = d.boards[seat];
    if (board.guesses.some((g) => guessKey(g.ids) === guessKey(ids))) return fail(409, "Already guessed!");
    try {
      playGuesses(puzzle, [...board.guesses.map((g) => g.ids), ids]);
    } catch (err) {
      return fail(400, (err as Error).message);
    }
    board.guesses.push({ ids: [...ids], at: now });
    return { ok: true, party: advanceParty(d, now) };
  });
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/**
 * What one trainer (or a visitor: null) may see right now. Before the end:
 * the tiles (once the race starts), everyone's placings as counts, and your
 * own found groups. After it: all four groups explained.
 */
export function partyView(party: ConnectionsParty, playerId: string | null, now: number, rev: number): PartyView {
  const seat = playerId ? seatOfParty(party, playerId) : -1;
  const start = party.startsAt;
  const begun = start !== undefined && (party.status === "finished" || now >= start);
  const puzzle = begun ? partyPuzzle(party) : null;
  const races = puzzle ? partyRaces(party, puzzle) : [];
  const mine = puzzle && seat >= 0 ? races[seat] : undefined;
  return {
    kind: "party",
    code: party.code,
    rev,
    now,
    status: party.status,
    you: seat >= 0 ? seat : null,
    min: PARTY_MIN,
    max: PARTY_MAX,
    players: party.players.map((p, i) => ({ name: p.name, ready: p.ready, away: now - p.seenAt > PARTY_AWAY_SHOWN_MS, host: i === 0, left: !!p.left })),
    ...(party.status === "playing" && start !== undefined && { round: { startsAt: start, endsAt: start + PARTY_MS } }),
    ...(puzzle && { tiles: puzzle.tiles.map(connTile) }),
    standings: puzzle ? partyStandings(party, races, now) : [],
    ...(puzzle &&
      mine && {
        mine: {
          guesses: party.boards[seat].guesses.map((g) => g.ids),
          results: mine.results.map((r) => r.kind),
          found: mine.found.map((lv) => groupReveal(puzzle, lv)),
        },
      }),
    ...(party.status === "finished" && puzzle && { reveal: ([0, 1, 2, 3] as ConnLevel[]).map((lv) => explainGroup(puzzle, lv)) }),
    ...(party.end && { end: party.end }),
  };
}
