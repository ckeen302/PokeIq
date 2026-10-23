import "server-only";
import { CONN_DUEL_MS, CONN_DUEL_PENALTY_MS, type ConnDuelBoard, type ConnDuelView } from "@/lib/pvp-types";
import { CONN_GROUP_SIZE, CONN_GROUPS, guessKey, type ConnLevel } from "@/lib/connections/types";
import { generatePuzzle, playGuesses, type PlayState, type Puzzle } from "@/lib/connections/generator";
import { isProvisional } from "@/lib/ranked";
import { connTile, explainGroup, groupReveal } from "./connections";
import type { ConnRankedInfo } from "./connections-ranked";
import { baseView, fail, finish, newSeat, notPlaying, pvpBase, seatOf, seated, type PvpBase, type PvpOutcome, type PvpRules } from "./duel-core";

/**
 * PokéConnections duels: a race. Both trainers get the same sixteen
 * Pokémon, from the practice generator seeded by the duel (its own `duel:`
 * seeds, which the practice endpoint can't reach, and never a daily). The
 * first to find all four groups wins; each mistake adds CONN_DUEL_PENALTY_MS
 * to a solve's time, so a quick but sloppy solve can still lose; four
 * mistakes and you're out. If both are out (or the clock runs out), the
 * trainer who found more groups wins, then the one with fewer mistakes.
 *
 * Every guess is checked here. Each trainer sees the other's progress as
 * colours and counts only (groups found, mistakes used), never which
 * Pokémon; the groups' names and Pokémon reach a trainer only as they find
 * them, and all four, explained, only once the duel is over.
 *
 * As with every duel, nothing runs on a timer: each request catches the duel
 * up, every step dated by the rules (see decidedAt) rather than by when the
 * request arrived.
 */

interface ConnDuelGuess {
  ids: number[];
  at: number;
}

export interface ConnectionsDuel extends PvpBase {
  kind: "connections";
  /** When the race starts (set once both trainers are ready). */
  startsAt?: number;
  /** One per seat: every guess, oldest first (repeats are never stored). */
  boards: { guesses: ConnDuelGuess[] }[];
  /** How the trainers met: the casual or the ranked queue (absent: a friend's invite, or a rematch, which is always casual). */
  queue?: "casual" | "ranked";
  ranked?: ConnRankedInfo;
}

// ---------------------------------------------------------------------------
// The puzzle
// ---------------------------------------------------------------------------

const puzzles = new Map<string, Puzzle>();

/** The duel's puzzle: the practice generator, seeded by the duel (server-side only). */
export function duelPuzzle(d: Pick<ConnectionsDuel, "seed">): Puzzle {
  let p = puzzles.get(d.seed);
  if (!p) {
    p = generatePuzzle(`duel:${d.seed}`);
    if (puzzles.size > 200) puzzles.clear();
    puzzles.set(d.seed, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Where each trainer stands
// ---------------------------------------------------------------------------

export interface SeatRace extends PlayState {
  /** Out of mistakes. */
  out: boolean;
  /** When the trainer solved it or ran out. */
  doneAt?: number;
  /** Their last guess (the start if none). */
  lastAt: number;
  /** A solve's time plus the penalties. */
  score?: number;
}

export function seatRace(d: Pick<ConnectionsDuel, "boards" | "startsAt">, puzzle: Puzzle, seat: number): SeatRace {
  const guesses = d.boards[seat]?.guesses ?? [];
  const start = d.startsAt ?? 0;
  const state = playGuesses(puzzle, guesses.map((g) => g.ids));
  const lastAt = guesses.length ? guesses[guesses.length - 1].at : start;
  const doneAt = state.over ? lastAt : undefined;
  return {
    ...state,
    out: state.over && !state.won,
    lastAt,
    ...(doneAt !== undefined && { doneAt }),
    ...(state.won && { score: lastAt - start + state.mistakes * CONN_DUEL_PENALTY_MS }),
  };
}

/**
 * How a trainer ranks at the end: a solve beats no solve, and among solves
 * the lower score (time plus penalties); otherwise more groups found, then
 * fewer mistakes.
 */
export const raceRank = (s: SeatRace): number[] => (s.won ? [2, -s.score!] : [1, s.found.length, -s.mistakes]);

/** The winning seat, or null for a draw. */
export function raceWinner(s: SeatRace[]): number | null {
  const [a, b] = s.map(raceRank);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] > b[i] ? 0 : 1;
  return null;
}

/**
 * The moment the race was settled, or Infinity while it's open:
 * - both trainers are done (solved or out);
 * - one has solved and the other can no longer beat their score (even a
 *   solve this instant would be too slow, counting their penalties so far:
 *   a tie goes to whoever solved first);
 * - one is out and the other has already found more groups (whatever
 *   happens next, they finish ahead).
 */
export function decidedAt(start: number, s: SeatRace[]): number {
  const [a, b] = s;
  if (a.over && b.over) return Math.max(a.doneAt!, b.doneAt!);
  for (const [done, other] of [
    [a, b],
    [b, a],
  ]) {
    if (!done.over || other.over) continue;
    if (done.won) return Math.max(start + done.score! - other.mistakes * CONN_DUEL_PENALTY_MS, done.doneAt!, other.lastAt);
    if (other.found.length > done.found.length) return Math.max(done.doneAt!, other.lastAt);
  }
  return Infinity;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const blankDuel = (base: PvpBase): ConnectionsDuel => ({ ...base, kind: "connections", boards: [] });

export const connectionsRules: PvpRules<ConnectionsDuel> = {
  begin(d, at) {
    d.startsAt = at;
    d.boards = d.players.map(() => ({ guesses: [] }));
  },
  play(d, now) {
    if (d.startsAt === undefined) return false;
    const puzzle = duelPuzzle(d);
    const races = [0, 1].map((seat) => seatRace(d, puzzle, seat));
    const at = Math.min(decidedAt(d.startsAt, races), d.startsAt + CONN_DUEL_MS);
    if (now < at) return false;
    finish(d, "played", raceWinner(races), at);
    return true;
  },
  blank: (base) => blankDuel(base),
};

export function createConnectionsDuel(
  name: string,
  code: string,
  now: number,
  seed?: string,
  extra: Pick<ConnectionsDuel, "queue" | "ranked"> = {}
): { duel: ConnectionsDuel; playerId: string } {
  const seat = newSeat(name, now);
  return { duel: { ...blankDuel(pvpBase("connections", code, [seat], now, seed)), ...extra }, playerId: seat.id };
}

// ---------------------------------------------------------------------------
// Guessing
// ---------------------------------------------------------------------------

/** A group of four, checked on the server: right, one away, or wrong (a mistake). */
export function guessConnections(duel: ConnectionsDuel, playerId: string, ids: number[], now: number): PvpOutcome<ConnectionsDuel> {
  return seated(connectionsRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "playing") return notPlaying(d);
    if (d.startsAt === undefined || now < d.startsAt) return fail(409, "The race hasn't started yet.");
    const puzzle = duelPuzzle(d);
    const race = seatRace(d, puzzle, seat);
    if (race.over) return fail(409, race.won ? "You've found every group: waiting for the result." : "You're out of mistakes: waiting for the result.");
    if (ids.length !== CONN_GROUP_SIZE || new Set(ids).size !== CONN_GROUP_SIZE) return fail(400, "Pick four different Pokémon.");
    const board = d.boards[seat];
    if (board.guesses.some((g) => guessKey(g.ids) === guessKey(ids))) return fail(409, "Already guessed!");
    try {
      playGuesses(puzzle, [...board.guesses.map((g) => g.ids), ids]);
    } catch (err) {
      return fail(400, (err as Error).message);
    }
    board.guesses.push({ ids: [...ids], at: now });
    return { ok: true, duel: d };
  });
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function boardView(race: SeatRace, start: number): ConnDuelBoard {
  return {
    found: race.found,
    mistakes: race.mistakes,
    solved: race.won,
    out: race.out,
    ...(race.doneAt !== undefined && { ms: race.doneAt - start }),
    ...(race.score !== undefined && { score: race.score }),
  };
}

/**
 * What one trainer (or a visitor: null) may see right now. Before the end:
 * the tiles (once the race starts), both boards as colours and counts, and
 * your own found groups. After it: every group explained, and both trainers'
 * guesses as colours.
 */
export function connectionsView(duel: ConnectionsDuel, playerId: string | null, now: number, rev: number): ConnDuelView {
  const seat = seatOf(duel, playerId);
  const start = duel.startsAt;
  const begun = start !== undefined && (duel.status === "finished" || now >= start);
  const puzzle = begun ? duelPuzzle(duel) : null;
  const races = puzzle ? duel.boards.map((_, k) => seatRace(duel, puzzle, k)) : [];
  const over = duel.status === "finished" && !!puzzle;
  const levelOf = puzzle ? new Map(puzzle.groups.flatMap((g, lv) => g.members.map((id) => [id, lv as ConnLevel] as const))) : null;
  const mineRace = seat >= 0 ? races[seat] : undefined;
  return {
    kind: "connections",
    ...baseView(duel, playerId, now, rev),
    ...(duel.queue && { queue: duel.queue }),
    // Ratings, never the keys behind them.
    ...(duel.ranked && { ranked: { season: duel.ranked.season, ratings: duel.ranked.ratings, provisional: duel.ranked.games.map(isProvisional), result: duel.ranked.result } }),
    ...(duel.status === "playing" && start !== undefined && { round: { startsAt: start, endsAt: start + CONN_DUEL_MS } }),
    ...(puzzle && { tiles: puzzle.tiles.map(connTile) }),
    boards: races.map((r) => boardView(r, start!)),
    ...(puzzle &&
      mineRace && {
        mine: {
          guesses: duel.boards[seat].guesses.map((g) => g.ids),
          results: mineRace.results.map((r) => r.kind),
          found: mineRace.found.map((lv) => groupReveal(puzzle, lv)),
        },
      }),
    ...(over && {
      reveal: ([0, 1, 2, 3] as ConnLevel[]).slice(0, CONN_GROUPS).map((lv) => explainGroup(puzzle, lv)),
      rows: duel.boards.map((b) => b.guesses.map((g) => g.ids.map((id) => levelOf!.get(id)!))),
    }),
  };
}
