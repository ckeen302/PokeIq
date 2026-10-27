import "server-only";
import { artworkUrl, getPokemon, MAX_GEN, type Pokemon } from "@/lib/pokemon/pokedex";
import { Rng } from "@/lib/rng";
import { dleHintCost, type DleRow } from "@/lib/dle-types";
import { CLASSIC_RULES, DLE_DEFAULT_SETTINGS, cleanSettings, dleRules, rangeOfGens, type DleRules, type DleSettings } from "@/lib/dle-format";
import {
  DLE_DUEL_HINTS,
  DLE_DUEL_IDLE_ROUNDS,
  DLE_DUEL_REVEAL_MS,
  DLE_DUEL_ROUNDS,
  DLE_DUEL_ROUND_MS,
  PVP_LEAD_MS,
  dleDuelBase,
  dleDuelSpeedIn,
  type DleDuelBoard,
  type DleDuelHint,
  type DleDuelRoundResult,
  type DleDuelScore,
  type DleDuelView,
} from "@/lib/pvp-types";
import { isProvisional } from "@/lib/ranked";
import { DLE_DEFAULT_ASSIST, DLE_RANKED_ASSIST, type DleAssist } from "@/lib/dle-assist";
import { deriveSeed } from "./crypto";
import type { RankedMatch } from "./ranked";
import { answerFor, compare, dailyPuzzleOf, puzzlePool } from "./pokedle";
import { stillPossible } from "./pokedle-candidates";
import { mediaUrl } from "./media-url";
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
  /**
   * The Pokédex assist level both trainers play with (absent: the Notebook).
   * The creator picks it in the lobby; matchmaking pairs trainers who
   * searched with the same one; ranked is always the Notebook.
   */
  assist?: DleAssist;
  /**
   * The format and settings both trainers play by (absent: Classic): the
   * creator picks them in the lobby (setPokedleSettings); casual matchmaking
   * has a queue per format; ranked is always Classic. Generations stay in
   * `gens`. See duelRules.
   */
  settings?: Omit<DleSettings, "gens">;
  /** Points so far. */
  totals: number[];
  rounds: DleDuelRound[];
  /** How the trainers met: the casual or the ranked queue (absent: a friend's invite, or a rematch, which is always casual). */
  queue?: "casual" | "ranked";
  ranked?: PokedleRanked;
}

/** A ranked duel's trainers, as the ratings know them. */
export interface PokedleRanked {
  /** Each seat's rating key (an HMAC). Server-side only. */
  keys: [string, string];
  /** Each seat's rating and ranked games going in. */
  ratings: [number, number];
  games: [number, number];
  /** Each seat's rating before and after, once the duel has been counted. */
  result?: { before: [number, number]; after: [number, number] };
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
  return new Set([-1, 0, 1].flatMap((k) => (["classic", "squirdle"] as const).map((f) => answerFor(dailyPuzzleOf(utcDate(at + k * DAY_MS), f)).id)));
}

/**
 * The rules a duel is played by: Classic for ranked and for duels without
 * settings, else the creator's settings over the duel's generations. Duels
 * always have a round clock: 3 minutes, or 60 seconds for blitz.
 */
export function duelRules(d: Pick<PokedleDuel, "ranked" | "settings" | "gens">): DleRules {
  const gens = d.ranked ? [] : (d.gens ?? []);
  const base = d.ranked || !d.settings ? { ...CLASSIC_RULES } : dleRules({ ...d.settings, gens: rangeOfGens(gens) });
  return { ...base, gens, timer: base.timer === "60s" ? "60s" : "3m" };
}

/** How long a round's guessing lasts. */
export const roundMsOf = (rules: Pick<DleRules, "timer">) => (rules.timer === "60s" ? 60_000 : DLE_DUEL_ROUND_MS);

/**
 * Round `index`'s secret: drawn by the duel's seed (so both trainers get the
 * same one) from the duel's generations (and only legendary and mythical
 * Pokémon with that pool), never one this duel has already had, and never
 * today's solo daily answer in either format.
 */
export function pickSecret(seed: string, index: number, at: number, taken: readonly number[], gens?: number[], legendary = false): number {
  const avoid = new Set([...taken, ...dailySecrets(at)]);
  const all = puzzlePool({ gens, legendary });
  const pool = all.filter((p) => !avoid.has(p.id));
  return new Rng(deriveSeed("pokedle-duel", `${seed}:${index}`)).pick(pool.length ? pool : all).id;
}

function newRound(d: PokedleDuel, startsAt: number): DleDuelRound {
  return {
    secret: pickSecret(d.seed, d.rounds.length, startsAt, d.rounds.map((r) => r.secret), d.gens, duelRules(d).pool === "legendary"),
    startsAt,
    guesses: d.players.map(() => []),
    hints: d.players.map(() => ({})),
    skip: d.players.map(() => false),
  };
}

/** One seat's standing in a round. */
function standing(round: DleDuelRound, seat: number, rules: Pick<DleRules, "maxGuesses">) {
  const g = round.guesses[seat];
  const solved = g.length > 0 && g[g.length - 1].id === round.secret;
  return {
    count: g.length,
    solved,
    done: solved || g.length >= rules.maxGuesses,
    last: g.length ? g[g.length - 1].at : round.startsAt,
    ms: solved ? g[g.length - 1].at - round.startsAt : undefined,
  };
}

/** A seat's points for a round: the solve, its speed, less the hints bought. */
function roundScore(round: DleDuelRound, seat: number, rules: DleRules): DleDuelScore {
  const s = standing(round, seat, rules);
  const base = s.solved ? dleDuelBase(s.count) : 0;
  const speed = s.ms !== undefined ? dleDuelSpeedIn(s.ms, roundMsOf(rules)) : 0;
  // The same hint costs as solo Pokédle (dleScore there is this without the speed bonus).
  const cost = dleHintCost(DLE_DUEL_HINTS.filter((hint) => round.hints[seat][hint] !== undefined));
  return { guesses: s.count, solved: s.solved, ms: s.ms, base, speed, cost, points: Math.max(0, base + speed - cost) };
}

/** When guessing closes, solved or not. */
const closesAt = (round: DleDuelRound, rules: DleRules) => round.startsAt + roundMsOf(rules);

/** The most points wins; then fewer guesses in all; then less time (a round not solved counts in full). */
function winnerOf(d: PokedleDuel): number | null {
  const rules = duelRules(d);
  const tally = d.players.map((_, seat) => ({
    points: d.totals[seat],
    guesses: d.rounds.reduce((sum, r) => sum + r.guesses[seat].length, 0),
    ms: d.rounds.reduce((sum, r) => sum + (standing(r, seat, rules).ms ?? roundMsOf(rules)), 0),
  }));
  const [a, b] = tally;
  if (a.points !== b.points) return a.points > b.points ? 0 : 1;
  if (a.guesses !== b.guesses) return a.guesses < b.guesses ? 0 : 1;
  if (a.ms !== b.ms) return a.ms < b.ms ? 0 : 1;
  return null;
}

function closeRound(d: PokedleDuel, round: DleDuelRound, at: number, timedOut: boolean) {
  const rules = duelRules(d);
  const points = d.players.map((_, seat) => roundScore(round, seat, rules).points);
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

const blankDuel = (base: PvpBase, gens?: number[], assist?: DleAssist, settings?: PokedleDuel["settings"]): PokedleDuel => ({
  ...base,
  kind: "pokedle",
  ...(gens && { gens }),
  ...(assist && assist !== DLE_DEFAULT_ASSIST && { assist }),
  ...(settings && { settings }),
  totals: [0, 0],
  rounds: [],
});

/** Settings as a duel keeps them: cleaned, without the generations (`gens` holds those); none for plain Classic. */
export function duelSettingsOf(raw: unknown): PokedleDuel["settings"] {
  const { gens: _gens, ...rest } = cleanSettings(raw);
  void _gens;
  const { gens: _d, ...plain } = DLE_DEFAULT_SETTINGS;
  void _d;
  return JSON.stringify(rest) === JSON.stringify(plain) ? undefined : rest;
}

/** The level a duel is played at. */
export const duelAssist = (d: Pick<PokedleDuel, "assist" | "ranked">): DleAssist => (d.ranked ? DLE_RANKED_ASSIST : (d.assist ?? DLE_DEFAULT_ASSIST));

export const pokedleRules: PvpRules<PokedleDuel> = {
  begin(d, at) {
    d.rounds = [newRound(d, at)];
  },
  play(d, now) {
    const round = d.rounds[d.rounds.length - 1];
    if (!round.result) {
      const rules = duelRules(d);
      const seats = d.players.map((_, seat) => standing(round, seat, rules));
      if (seats.every((s) => s.done)) closeRound(d, round, Math.max(...seats.map((s) => s.last)), false);
      else if (now > closesAt(round, rules) + GRACE_MS) closeRound(d, round, closesAt(round, rules) + GRACE_MS, true);
      else return false;
      return true;
    }
    if (now < round.result.nextAt) return false;
    d.rounds.push(newRound(d, round.result.nextAt + PVP_LEAD_MS));
    return true;
  },
  // A rematch keeps the generations, the assist level and the settings (a rematch is always casual, never ranked).
  blank: (base, like) => blankDuel(base, like.gens, duelAssist(like), like.ranked ? undefined : like.settings),
};

export function createPokedleDuel(
  name: string,
  code: string,
  now: number,
  seed?: string,
  extra: Pick<PokedleDuel, "queue" | "ranked" | "assist"> & { settings?: unknown } = {}
): { duel: PokedleDuel; playerId: string } {
  const seat = newSeat(name, now);
  const { assist, settings, ...rest } = extra;
  // Ranked is always Classic, with the Notebook.
  const base = blankDuel(pvpBase("pokedle", code, [seat], now, seed), undefined, rest.ranked ? undefined : assist, rest.ranked ? undefined : duelSettingsOf(settings));
  return { duel: { ...base, ...rest }, playerId: seat.id };
}

/** A finished ranked duel that hasn't been counted yet: what counting it needs. Null otherwise. */
export function rankedMatchOf(duel: PokedleDuel): RankedMatch | null {
  if (!duel.ranked || duel.ranked.result || duel.status !== "finished" || !duel.end || duel.players.length !== 2) return null;
  return {
    code: duel.code,
    keys: duel.ranked.keys,
    names: [duel.players[0].name, duel.players[1].name],
    reason: duel.end.reason,
    winner: duel.end.winner,
  };
}

/** Records how a ranked duel was counted (once: a later call changes nothing). */
export function withRankedResult(duel: PokedleDuel, result: { before: [number, number]; after: [number, number] }): PokedleDuel {
  if (!duel.ranked || duel.ranked.result) return duel;
  return { ...duel, ranked: { ...duel.ranked, result } };
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

/** In the lobby, the trainer who made the duel picks the Pokédex assist level both play with. */
export function setPokedleAssist(duel: PokedleDuel, playerId: string, assist: DleAssist, now: number): PvpOutcome<PokedleDuel> {
  return seated(pokedleRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The duel has already started.");
    if (seat !== 0) return fail(403, "Only the trainer who made the duel picks the Pokédex assist.");
    if (d.ranked) return fail(409, "Ranked duels always use the Notebook.");
    if (assist === duelAssist(d)) return { ok: true, duel: d };
    if (assist === DLE_DEFAULT_ASSIST) delete d.assist;
    else d.assist = assist;
    // Both get to see the change before the duel starts.
    for (const p of d.players) p.ready = false;
    return { ok: true, duel: d };
  });
}

/** In the lobby, the trainer who made the duel picks the format and settings both play by (the guest sees them). */
export function setPokedleSettings(duel: PokedleDuel, playerId: string, settings: unknown, now: number): PvpOutcome<PokedleDuel> {
  return seated(pokedleRules, duel, playerId, now, (d, seat) => {
    if (d.status !== "lobby") return fail(409, "The duel has already started.");
    if (seat !== 0) return fail(403, "Only the trainer who made the duel picks the settings.");
    if (d.ranked) return fail(409, "Ranked duels are always Classic.");
    const next = duelSettingsOf(settings);
    if (JSON.stringify(next) === JSON.stringify(d.settings)) return { ok: true, duel: d };
    if (next) d.settings = next;
    else delete d.settings;
    // Both get to see the change before the duel starts.
    for (const p of d.players) p.ready = false;
    return { ok: true, duel: d };
  });
}

export function guessPokedle(duel: PokedleDuel, playerId: string, index: number, pokemonId: number, now: number): PvpOutcome<PokedleDuel> {
  return seated(pokedleRules, duel, playerId, now, (d, seat) => {
    const round = liveRound(d, index, now);
    if ("ok" in round) return round;
    const s = standing(round, seat, duelRules(d));
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
    const rules = duelRules(d);
    if (!rules.hints) return fail(409, "Hints are off in this duel.");
    const s = standing(round, seat, rules);
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

/** A seat's rows: only the columns the duel's rules show. */
function rowsOf(round: DleDuelRound, seat: number, rules: DleRules): DleRow[] {
  const answer = getPokemon(round.secret)!;
  return round.guesses[seat].map((g) => compare(getPokemon(g.id)!, answer, rules));
}

/**
 * After each of a seat's guesses, how many Pokémon (of the duel's
 * generations) still fit every clue it has shown: stored with each guess,
 * worked out here only for guesses made before the meter existed.
 */
function possibleAfter(d: PokedleDuel, round: DleDuelRound, seat: number): number[] {
  const guesses = round.guesses[seat];
  if (guesses.every((g) => g.left !== undefined)) return guesses.map((g) => g.left!);
  const rules = duelRules(d);
  return stillPossible(
    getPokemon(round.secret)!,
    guesses.map((g) => getPokemon(g.id)!),
    puzzlePool({ gens: d.gens, legendary: rules.pool === "legendary" }),
    rules
  );
}

function boardOf(d: PokedleDuel, round: DleDuelRound, seat: number, rows: DleRow[], rules: DleRules): DleDuelBoard {
  const s = standing(round, seat, rules);
  return {
    colours: rows.map((row) => rules.columns.map((c) => row.cells[c]!.status)),
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
  const rules = duelRules(duel);
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
          const rows = rowsOf(r, k, rules);
          return { ...boardOf(duel, r, k, rows, rules), rows };
        }),
        scores: r.guesses.map((_, k) => roundScore(r, k, rules)),
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
      endsAt: closesAt(live, rules),
      // Only colours and hint badges of the opponent's round: their rows stay here.
      boards: live.guesses.map((_, k) => boardOf(duel, live, k, rowsOf(live, k, rules), rules)),
      rows: seat >= 0 ? rowsOf(live, seat, rules) : [],
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
    assist: duelAssist(duel),
    rules,
    pool: puzzlePool({ gens: duel.gens, legendary: rules.pool === "legendary" }).length,
    rounds: DLE_DUEL_ROUNDS,
    totals: duel.totals,
    round,
    revealed,
    next: duel.status === "playing" && last?.result ? { at: last.result.nextAt, pressed: last.skip } : undefined,
    queue: duel.queue,
    // Ratings, never the keys behind them.
    ranked: duel.ranked && {
      ratings: duel.ranked.ratings,
      provisional: duel.ranked.games.map(isProvisional),
      result: duel.ranked.result,
    },
  };
}
