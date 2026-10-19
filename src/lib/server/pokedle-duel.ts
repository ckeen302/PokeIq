import "server-only";
import { artworkUrl, getPokemon, MAX_GEN, poolFor, type Pokemon } from "@/lib/pokemon/pokedex";
import { Rng } from "@/lib/rng";
import { DLE_COLUMNS, DLE_MAX_GUESSES, dleHintCost, type DleRow } from "@/lib/dle-types";
import {
  DLE_DUEL_HINTS,
  DLE_DUEL_IDLE_ROUNDS,
  DLE_DUEL_REVEAL_MS,
  DLE_DUEL_ROUNDS,
  DLE_DUEL_ROUND_MS,
  PVP_LEAD_MS,
  dleDuelBase,
  dleDuelSpeed,
  type DleDuelBoard,
  type DleDuelHint,
  type DleDuelRoundResult,
  type DleDuelScore,
  type DleDuelView,
} from "@/lib/pvp-types";
import { deriveSeed } from "./crypto";
import { answerFor, compare } from "./pokedle";
import { stillPossible } from "./pokedle-candidates";
import { mediaUrl } from "./session";
import {
  baseView,
  fail,
  finish,
  newSeat,
  notPlaying,
  pvpBase,
  seatOf,
  seated,
  type PvpBase,
  type PvpOutcome,
  type PvpRules,
} from "./duel-core";

/**
 * Pokédle duels: two trainers chase the same secret Pokémon for three rounds,
 * with solo Pokédle's guesses and clues. A solve scores 1,000 for the first
 * guess down to 300 for the last, plus up to 150 for speed; hints are
 * opt-in and cost points. The most points after three rounds wins (then
 * fewer guesses, then less time).
 *
 * Each trainer sees the other's progress as it happens, but only as colours,
 * which hints they bought and how many Pokémon still fit their clues: the
 * Pokémon they guessed, the hints themselves and the secret leave the server
 * once the round is over. A round ends when both trainers have solved or run
 * out of guesses, or after three minutes.
 */

interface DleDuelGuess {
  id: number;
  at: number;
  /**
   * Pokémon still possible after this guess, worked out once when it's made
   * (polls only read it). Absent on guesses from before the meter existed.
   */
  left?: number;
}

interface DleDuelRound {
  /** The secret Pokémon's id. Server-side only until the round is over. */
  secret: number;
  startsAt: number;
  /** One list per seat, oldest first. */
  guesses: DleDuelGuess[][];
  /** One per seat: the hints bought, and when. */
  hints: Partial<Record<DleDuelHint, number>>[];
  /** Trainers who pressed Next during the reveal. */
  skip: boolean[];
  /** Set when the round is over. */
  result?: { at: number; timedOut: boolean; points: number[]; nextAt: number };
}

export interface PokedleDuel extends PvpBase {
  kind: "pokedle";
  /** Secrets come from these generations (none: all of them). */
  gens?: number[];
  /** Points so far. */
  totals: number[];
  rounds: DleDuelRound[];
}

/** A guess sent just before the bell still counts if it arrives within this long after it. */
const GRACE_MS = 1_000;
const DAY_MS = 86_400_000;

const utcDate = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Solo Pokédle's daily answers that someone, somewhere, could be playing at
 * `at` (the server accepts local dates within a day of UTC).
 */
function dailySecrets(at: number): Set<number> {
  return new Set([-1, 0, 1].map((k) => answerFor({ id: `daily:${utcDate(at + k * DAY_MS)}` }).id));
}

/**
 * Round `index`'s secret: drawn by the duel's seed (so both trainers get the
 * same one) from the duel's generations, never one this duel has already
 * had, and never today's solo daily answer.
 */
export function pickSecret(seed: string, index: number, at: number, taken: readonly number[], gens?: number[]): number {
  const avoid = new Set([...taken, ...dailySecrets(at)]);
  const pool = poolFor(gens).filter((p) => !avoid.has(p.id));
  return new Rng(deriveSeed("pokedle-duel", `${seed}:${index}`)).pick(pool).id;
}

function newRound(d: PokedleDuel, startsAt: number): DleDuelRound {
  return {
    secret: pickSecret(d.seed, d.rounds.length, startsAt, d.rounds.map((r) => r.secret), d.gens),
    startsAt,
    guesses: d.players.map(() => []),
    hints: d.players.map(() => ({})),
    skip: d.players.map(() => false),
  };
}

/** One seat's standing in a round. */
function standing(round: DleDuelRound, seat: number) {
  const g = round.guesses[seat];
  const solved = g.length > 0 && g[g.length - 1].id === round.secret;
  return {
    count: g.length,
    solved,
    done: solved || g.length >= DLE_MAX_GUESSES,
    last: g.length ? g[g.length - 1].at : round.startsAt,
    ms: solved ? g[g.length - 1].at - round.startsAt : undefined,
  };
}

/** A seat's points for a round: the solve, its speed, less the hints bought. */
function roundScore(round: DleDuelRound, seat: number): DleDuelScore {
  const s = standing(round, seat);
  const base = s.solved ? dleDuelBase(s.count) : 0;
  const speed = s.ms !== undefined ? dleDuelSpeed(s.ms) : 0;
  // The same hint costs as solo Pokédle (dleScore there is this without the speed bonus).
  const cost = dleHintCost(DLE_DUEL_HINTS.filter((hint) => round.hints[seat][hint] !== undefined));
  return { guesses: s.count, solved: s.solved, ms: s.ms, base, speed, cost, points: Math.max(0, base + speed - cost) };
}

/** When guessing closes, solved or not. */
const closesAt = (round: DleDuelRound) => round.startsAt + DLE_DUEL_ROUND_MS;

/** The most points wins; then fewer guesses in all; then less time (a round not solved counts in full). */
function winnerOf(d: PokedleDuel): number | null {
  const tally = d.players.map((_, seat) => ({
    points: d.totals[seat],
    guesses: d.rounds.reduce((sum, r) => sum + r.guesses[seat].length, 0),
    ms: d.rounds.reduce((sum, r) => sum + (standing(r, seat).ms ?? DLE_DUEL_ROUND_MS), 0),
  }));
  const [a, b] = tally;
  if (a.points !== b.points) return a.points > b.points ? 0 : 1;
  if (a.guesses !== b.guesses) return a.guesses < b.guesses ? 0 : 1;
  if (a.ms !== b.ms) return a.ms < b.ms ? 0 : 1;
  return null;
}

function closeRound(d: PokedleDuel, round: DleDuelRound, at: number, timedOut: boolean) {
  const points = d.players.map((_, seat) => roundScore(round, seat).points);
  round.result = { at, timedOut, points, nextAt: at + DLE_DUEL_REVEAL_MS };
  d.totals = d.totals.map((t, seat) => t + points[seat]);

  // Sitting out: the clock ran out on a round without a single guess from you.
  const idle = d.players.map(
    (_, seat) =>
      d.rounds.length >= DLE_DUEL_IDLE_ROUNDS &&
      d.rounds.slice(-DLE_DUEL_IDLE_ROUNDS).every((r) => r.result?.timedOut && r.guesses[seat].length === 0)
  );
  if (idle[0] !== idle[1]) finish(d, "idle", idle[0] ? 1 : 0, at);
  else if (idle[0]) finish(d, "idle", winnerOf(d), at);
  else if (d.rounds.length >= DLE_DUEL_ROUNDS) finish(d, "played", winnerOf(d), at);
}

const blankDuel = (base: PvpBase, gens?: number[]): PokedleDuel => ({ ...base, kind: "pokedle", ...(gens && { gens }), totals: [0, 0], rounds: [] });

export const pokedleRules: PvpRules<PokedleDuel> = {
  begin(d, at) {
    d.rounds = [newRound(d, at)];
  },
  play(d, now) {
    const round = d.rounds[d.rounds.length - 1];
    if (!round.result) {
      const seats = d.players.map((_, seat) => standing(round, seat));
      if (seats.every((s) => s.done)) closeRound(d, round, Math.max(...seats.map((s) => s.last)), false);
      else if (now > closesAt(round) + GRACE_MS) closeRound(d, round, closesAt(round) + GRACE_MS, true);
      else return false;
      return true;
    }
    if (now < round.result.nextAt) return false;
    d.rounds.push(newRound(d, round.result.nextAt + PVP_LEAD_MS));
    return true;
  },
  blank: (base, like) => blankDuel(base, like.gens),
};

export function createPokedleDuel(name: string, code: string, now: number, seed?: string): { duel: PokedleDuel; playerId: string } {
  const seat = newSeat(name, now);
  return { duel: blankDuel(pvpBase("pokedle", code, [seat], now, seed)), playerId: seat.id };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** The live round, if `index` is it and it has started; else why not. */
function liveRound(d: PokedleDuel, index: number, now: number): DleDuelRound | ReturnType<typeof fail> {
  if (d.status !== "playing") return notPlaying(d);
  const round = d.rounds[d.rounds.length - 1];
  if (index !== d.rounds.length - 1 || round.result) return fail(409, "That round is over.");
  if (now < round.startsAt) return fail(409, "The round hasn't started yet.");
  return round;
}

/** In the lobby, the trainer who made the duel picks the generations secrets come from (none: all). */
export function setPokedleGens(duel: PokedleDuel, playerId: string, gens: number[], now: number): PvpOutcome<PokedleDuel> {
  return seated(pokedleRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The duel has already started.");
    if (seat !== 0) return fail(403, "Only the trainer who made the duel picks the generations.");
    const unique = [...new Set(gens)].filter((g) => Number.isInteger(g) && g >= 1 && g <= MAX_GEN).sort((a, b) => a - b);
    const next = unique.length > 0 && unique.length < MAX_GEN ? unique : undefined;
    if (JSON.stringify(next) === JSON.stringify(d.gens)) return { ok: true, duel: d };
    if (next) d.gens = next;
    else delete d.gens;
    // Both get to see the change before the duel starts.
    for (const p of d.players) p.ready = false;
    return { ok: true, duel: d };
  });
}

export function guessPokedle(duel: PokedleDuel, playerId: string, index: number, pokemonId: number, now: number): PvpOutcome<PokedleDuel> {
  return seated(pokedleRules, duel, playerId, now, (d, seat) => {
    const round = liveRound(d, index, now);
    if ("ok" in round) return round;
    const s = standing(round, seat);
    if (s.solved) return fail(409, "You've already solved this one.");
    if (s.done) return fail(409, "You're out of guesses.");
    if (!getPokemon(pokemonId)) return fail(400, "Unknown Pokémon.");
    if (round.guesses[seat].some((g) => g.id === pokemonId)) return fail(409, "You've already guessed that one.");
    const guess: DleDuelGuess = { id: pokemonId, at: now };
    round.guesses[seat].push(guess);
    // Worked out once, here: the polls that follow only read it.
    guess.left = possibleAfter(d, round, seat).at(-1);
    return { ok: true, duel: d };
  });
}

/** Buys a hint for this round: once each, after your first guess, while you're still guessing. */
export function buyPokedleHint(duel: PokedleDuel, playerId: string, index: number, hint: DleDuelHint, now: number): PvpOutcome<PokedleDuel> {
  return seated(pokedleRules, duel, playerId, now, (d, seat) => {
    const round = liveRound(d, index, now);
    if ("ok" in round) return round;
    const s = standing(round, seat);
    if (s.count === 0) return fail(409, "Hints open after your first guess.");
    if (s.done) return fail(409, "You're done with this round.");
    if (round.hints[seat][hint] !== undefined) return fail(409, "You already have that hint.");
    round.hints[seat][hint] = now;
    return { ok: true, duel: d };
  });
}

/** Next round, please: once both trainers press it, the reveal ends early. */
export function skipPokedleReveal(duel: PokedleDuel, playerId: string, index: number, now: number): PvpOutcome<PokedleDuel> {
  return seated(pokedleRules, duel, playerId, now, (d, seat) => {
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

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** A round's secret. Server-side only: it goes to the browser once the round is over, never before. */
export const roundSecret = (duel: PokedleDuel, index: number): Pokemon => getPokemon(duel.rounds[index].secret)!;

function rowsOf(round: DleDuelRound, seat: number): DleRow[] {
  const answer = getPokemon(round.secret)!;
  return round.guesses[seat].map((g) => compare(getPokemon(g.id)!, answer));
}

/**
 * After each of a seat's guesses, how many Pokémon (of the duel's
 * generations) still fit every clue it has shown: stored with each guess,
 * worked out here only for guesses made before the meter existed.
 */
function possibleAfter(d: PokedleDuel, round: DleDuelRound, seat: number): number[] {
  const guesses = round.guesses[seat];
  if (guesses.every((g) => g.left !== undefined)) return guesses.map((g) => g.left!);
  return stillPossible(
    getPokemon(round.secret)!,
    guesses.map((g) => getPokemon(g.id)!),
    poolFor(d.gens)
  );
}

function boardOf(d: PokedleDuel, round: DleDuelRound, seat: number, rows: DleRow[]): DleDuelBoard {
  const s = standing(round, seat);
  return {
    colours: rows.map((row) => DLE_COLUMNS.map((c) => row.cells[c.key].status)),
    solved: s.solved,
    done: s.done,
    ms: s.ms,
    hints: DLE_DUEL_HINTS.filter((hint) => round.hints[seat][hint] !== undefined),
    possible: possibleAfter(d, round, seat),
  };
}

/** What one trainer (or a visitor: null) may see of the duel right now. */
export function pokedleView(duel: PokedleDuel, playerId: string | null, now: number, rev: number): DleDuelView {
  const seat = seatOf(duel, playerId);
  const totals = [0, 0];
  const revealed = duel.rounds.flatMap((r, index): DleDuelRoundResult[] => {
    if (!r.result) return [];
    const answer = getPokemon(r.secret)!;
    r.result.points.forEach((p, k) => (totals[k] += p));
    return [
      {
        index,
        answer: { id: answer.id, name: answer.name, imageUrl: artworkUrl(answer.id), genus: answer.genus },
        boards: r.guesses.map((_, k) => {
          const rows = rowsOf(r, k);
          return { ...boardOf(duel, r, k, rows), rows };
        }),
        scores: r.guesses.map((_, k) => roundScore(r, k)),
        totals: [...totals],
        timedOut: r.result.timedOut,
      },
    ];
  });

  const last = duel.rounds[duel.rounds.length - 1];
  const live = duel.status === "playing" && last && !last.result ? last : undefined;
  let round: DleDuelView["round"];
  if (live) {
    const answer = getPokemon(live.secret)!;
    const bought = seat >= 0 ? live.hints[seat] : {};
    round = {
      index: duel.rounds.length - 1,
      startsAt: live.startsAt,
      endsAt: closesAt(live),
      // Only colours and hint badges of the opponent's round: their rows stay here.
      boards: live.guesses.map((_, k) => boardOf(duel, live, k, rowsOf(live, k))),
      rows: seat >= 0 ? rowsOf(live, seat) : [],
      // Your own hints, and only the ones you bought.
      hints: {
        silhouetteUrl: bought.silhouette !== undefined ? mediaUrl({ kind: "silhouette", pokemonId: answer.id }) : undefined,
        genus: bought.genus !== undefined ? `The ${answer.genus}` : undefined,
      },
    };
  }

  return {
    kind: "pokedle",
    ...baseView(duel, playerId, now, rev),
    gens: duel.gens,
    pool: poolFor(duel.gens).length,
    rounds: DLE_DUEL_ROUNDS,
    totals: duel.totals,
    round,
    revealed,
    next: duel.status === "playing" && last?.result ? { at: last.result.nextAt, pressed: last.skip } : undefined,
  };
}
