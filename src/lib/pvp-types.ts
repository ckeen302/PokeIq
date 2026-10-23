/**
 * Duels beyond PokéGuessr: head-to-head Pokédle (and quizzes), played
 * through a share link like PokéGuessr duels. Shared by the server (which
 * applies every rule) and the client.
 */

import { DLE_GUESS_COST, DLE_HINT_COST, DLE_HINT_KINDS, DLE_SOLVE_POINTS, dleBasePoints, type CellStatus, type DleHint, type DleRow } from "./dle-types";
import type { DuelPlayerView, DuelStatus } from "./duel-types";
import type { Difficulty, ModuleId } from "@/engines/types";
import type { PublicQuestion } from "./session-types";
import type { DleAssist } from "./dle-assist";
import type { DleRules } from "./dle-format";
import type { ChatLine } from "./chat";
import type { PdkGridView } from "./pikadoku/types";
import type { ConnGroupExplained, ConnGroupReveal, ConnGuessKind, ConnLevel, ConnTile } from "./connections/types";

export const PVP_KINDS = ["pokedle", "quiz", "connections", "pikadoku"] as const;
export type PvpKind = (typeof PVP_KINDS)[number];

/** "Round 2" shows for a moment before play, so both trainers start together. */
export const PVP_LEAD_MS = 3_000;
/** A trainer the server hasn't heard from in this long has left: out of the lobby, or a forfeit mid-duel. */
export const PVP_AWAY_MS = 30_000;
/** Shown as "connection lost" after this long without a word. */
export const PVP_QUIET_MS = 10_000;

/** played: the duel ran its course. left: stopped responding or quit. idle: sat out rounds in a row. */
export type PvpEndReason = "played" | "left" | "idle";

export interface PvpEnd {
  reason: PvpEndReason;
  /** The winner's seat, or null for a draw. */
  winner: number | null;
  at: number;
}

interface PvpViewBase {
  code: string;
  status: DuelStatus;
  /** Server clock, so timers agree whatever the device's clock says. */
  now: number;
  /** Increases with every change, so a slow response never overwrites a newer one. */
  rev: number;
  /** Your seat (0: the trainer who made the duel), or null for a visitor. */
  you: number | null;
  players: DuelPlayerView[];
  end?: PvpEnd;
  /** Once either trainer asks for a rematch: the new duel's code. */
  rematch?: string;
  /** Rematches between the same two trainers make a best-of-three series (absent until both seats are filled). */
  series?: PvpSeriesView;
  /** Reactions sent in the last few seconds, oldest first. */
  emotes?: PvpEmoteView[];
  /** Chat, oldest first: open in the lobby and after the end. */
  chat?: ChatLine[];
}

/** The preset reactions duellists can send each other: no free text. */
export const DUEL_EMOTES = ["gg", "fire", "wow", "sweat", "clap"] as const;
export type DuelEmote = (typeof DUEL_EMOTES)[number];
export const EMOTE_TEXT: Record<DuelEmote, string> = { gg: "GG", fire: "🔥", wow: "😮", sweat: "😅", clap: "👏" };
/** A trainer may send a reaction at most this often, and at most EMOTE_BURST in any EMOTE_WINDOW_MS. */
export const EMOTE_GAP_MS = 1_500;
export const EMOTE_BURST = 3;
export const EMOTE_WINDOW_MS = 10_000;
/** A reaction shows for this long. */
export const EMOTE_SHOW_MS = 6_000;

export interface PvpEmoteView {
  /** Counts up with every reaction in the duel: each is shown once. */
  n: number;
  seat: number;
  emote: DuelEmote;
  at: number;
}

/** A series is best of three: the first trainer to win two games takes it. */
export const PVP_SERIES_BEST_OF = 3;
export const PVP_SERIES_WINS = 2;

export interface PvpSeriesView {
  /** This game's number in the series (draws add a game). */
  game: number;
  /** Games won per seat, this one included once it's over. */
  wins: number[];
  /** Games drawn, this one included once it's over. */
  draws: number;
  /** The seat that has taken the series, or null while it's open. */
  winner: number | null;
}

// ---------------------------------------------------------------------------
// Pokédle duels
// ---------------------------------------------------------------------------

/** Every duel is three rounds; the most points across them wins. */
export const DLE_DUEL_ROUNDS = 3;
/** Each round is open for three minutes at most. */
export const DLE_DUEL_ROUND_MS = 180_000;
/** The reveal stays up this long, unless both trainers press Next sooner. */
export const DLE_DUEL_REVEAL_MS = 15_000;
/** Running out the clock without a single guess this many rounds in a row is a forfeit. */
export const DLE_DUEL_IDLE_ROUNDS = 2;

/** A first-guess solve, down to 300 on the last guess: the same points as solo Pokédle (dle-types). */
export const DLE_DUEL_SOLVE_POINTS = DLE_SOLVE_POINTS;
export const DLE_DUEL_GUESS_COST = DLE_GUESS_COST;
/** Solving at once earns this much more, falling linearly to 0 at the round's time limit. */
export const DLE_DUEL_SPEED_BONUS = 150;

/** Hints are opt-in in a duel, once each per round after your first guess, and cost what they do solo. */
export const DLE_DUEL_HINTS = DLE_HINT_KINDS;
export type DleDuelHint = DleHint;
export const DLE_DUEL_HINT_COST = DLE_HINT_COST;

/** Points for solving in `guesses`. */
export const dleDuelBase = dleBasePoints;
/** The speed bonus for solving `ms` into a round. */
export const dleDuelSpeed = (ms: number) => dleDuelSpeedIn(ms, DLE_DUEL_ROUND_MS);
/** The speed bonus in a round of `roundMs` (a blitz duel's 60 seconds). */
export const dleDuelSpeedIn = (ms: number, roundMs: number) => Math.round(DLE_DUEL_SPEED_BONUS * Math.max(0, 1 - ms / roundMs));

/** One trainer's guesses in a round, as the opponent may see them: colours only, never the Pokémon. */
export interface DleDuelBoard {
  /** Each guess's feedback, oldest first, in the order of the duel's columns (rules.columns). */
  colours: CellStatus[][];
  solved: boolean;
  /** Solved, or out of guesses. */
  done: boolean;
  /** Time from the round's start to the solve. */
  ms?: number;
  /** Hints bought this round: the opponent sees which, never the hints themselves. */
  hints: DleDuelHint[];
  /**
   * After each guess, how many Pokémon still fit every clue this trainer has
   * seen: the race meter. Only the counts cross over, never the clues.
   */
  possible: number[];
}

/** A trainer's points for a round, and how they add up. */
export interface DleDuelScore {
  guesses: number;
  solved: boolean;
  /** Time to the solve. */
  ms?: number;
  /** For solving in that many guesses (0 if unsolved). */
  base: number;
  speed: number;
  /** Hints bought. */
  cost: number;
  /** base + speed − cost, never below 0. */
  points: number;
}

export interface DleDuelLiveRound {
  index: number;
  /** Server time guessing opens. */
  startsAt: number;
  /** Server time the round closes, solved or not. */
  endsAt: number;
  /** One per seat. */
  boards: DleDuelBoard[];
  /** Your own guesses with full feedback (empty for a visitor). */
  rows: DleRow[];
  /** The hints you bought. */
  hints: { silhouetteUrl?: string; genus?: string };
}

export interface DleDuelRoundResult {
  index: number;
  answer: { id: number; name: string; imageUrl: string; genus: string };
  /** Both trainers' guesses in full, now that the round is over. */
  boards: (DleDuelBoard & { rows: DleRow[] })[];
  scores: DleDuelScore[];
  /** Points so far, after this round. */
  totals: number[];
  /** The clock ran out. */
  timedOut: boolean;
}

export interface DleDuelView extends PvpViewBase {
  kind: "pokedle";
  /** The generations secrets come from (none: all of them). The creator picks in the lobby. */
  gens?: number[];
  /** The Pokédex assist level both trainers play with. The creator picks in the lobby; ranked is always the Notebook. */
  assist: DleAssist;
  /** The format and settings both play by (Classic for ranked): the columns shown, guesses, close states, hints, the round clock. The creator picks them in the lobby. */
  rules: DleRules;
  /** How many Pokémon could be the secret before any guess (the generations' whole Pokédex). */
  pool: number;
  rounds: number;
  /** Points so far. */
  totals: number[];
  /** The round being played, until it's over. */
  round?: DleDuelLiveRound;
  revealed: DleDuelRoundResult[];
  /** During a reveal: when the next round starts, and who has pressed Next. */
  next?: { at: number; pressed: boolean[] };
  /** How the trainers met: the casual or the ranked queue (absent: a friend's invite, or a rematch). */
  queue?: "casual" | "ranked";
  /** A ranked duel: each seat's rating going in, and once it's been counted, before and after. */
  ranked?: DleDuelRanked;
}

export interface DleDuelRanked {
  ratings: number[];
  provisional: boolean[];
  /** Set once the duel has been counted. */
  result?: { before: number[]; after: number[] };
}

// ---------------------------------------------------------------------------
// Quiz duels
// ---------------------------------------------------------------------------

/** Ten questions, the same for both trainers. */
export const QUIZ_DUEL_QUESTIONS = 10;
/** Each question is open this long. */
export const QUIZ_DUEL_QUESTION_MS = 15_000;
/** The reveal stays up this long, unless both trainers press Next sooner. */
export const QUIZ_DUEL_REVEAL_MS = 8_000;
/** No answer to this many questions in a row is a forfeit. */
export const QUIZ_DUEL_IDLE_QUESTIONS = 3;
/** A right answer scores this, plus up to QUIZ_DUEL_SPEED_BONUS for answering at once (as in solo Classic). */
export const QUIZ_DUEL_POINTS = 100;
export const QUIZ_DUEL_SPEED_BONUS = 50;

/** Points for a right answer `ms` into the question. */
export const quizDuelPoints = (ms: number) =>
  QUIZ_DUEL_POINTS + Math.round(QUIZ_DUEL_SPEED_BONUS * Math.max(0, 1 - ms / QUIZ_DUEL_QUESTION_MS));

/** A question as both trainers see it: the solo quiz's public question, without its timer. */
export type QuizDuelQuestionView = Pick<PublicQuestion, "module" | "prompt" | "detail" | "options" | "media" | "cards">;

export interface QuizDuelLiveQuestion {
  index: number;
  /** Server time the question appears. */
  startsAt: number;
  /** Server time answers close. */
  endsAt: number;
  /** Sent once the question has started. */
  question?: QuizDuelQuestionView;
  /** Who has locked in (never what they picked). */
  answered: boolean[];
  /** Your own pick, once locked in. */
  yours?: string;
}

export interface QuizDuelPick {
  choice: string;
  correct: boolean;
  /** Time from the question appearing to the pick. */
  ms: number;
  points: number;
}

export interface QuizDuelResult {
  index: number;
  question: QuizDuelQuestionView;
  answer: string;
  explanation?: string;
  /** The Pokémon's artwork, for the latest reveal only. */
  revealUrl?: string;
  learnHref?: string;
  sourceUrl?: string;
  /** One per seat: the pick, or null (no answer in time: 0 points). */
  picks: (QuizDuelPick | null)[];
  /** Points so far, after this question. */
  scores: number[];
}

export interface QuizDuelView extends PvpViewBase {
  kind: "quiz";
  module: ModuleId;
  difficulty: Difficulty;
  total: number;
  /** Points so far. */
  scores: number[];
  /** The question being played, until it's revealed. */
  question?: QuizDuelLiveQuestion;
  revealed: QuizDuelResult[];
  /** During a reveal: when the next question starts, and who has pressed Next. */
  next?: { at: number; pressed: boolean[] };
}

// ---------------------------------------------------------------------------
// PokéConnections duels
// ---------------------------------------------------------------------------

/** Each mistake adds this much to a solve's time. */
export const CONN_DUEL_PENALTY_MS = 15_000;
/** The race ends after this long, solved or not. */
export const CONN_DUEL_MS = 10 * 60_000;

/** A trainer's race as both trainers see it: colours and counts only, never which Pokémon. */
export interface ConnDuelBoard {
  /** The groups found, in the order found (their colours only). */
  found: ConnLevel[];
  mistakes: number;
  solved: boolean;
  /** Out of mistakes. */
  out: boolean;
  /** Time from the start to the solve (or to running out). */
  ms?: number;
  /** A solve's time plus CONN_DUEL_PENALTY_MS per mistake: the lower wins. */
  score?: number;
}

/** Your own race, in full. */
export interface ConnDuelMine {
  /** Every guess you made, oldest first (four Pokémon ids each). */
  guesses: number[][];
  results: ConnGuessKind[];
  /** The groups you found, with their names and Pokémon. */
  found: ConnGroupReveal[];
}

export interface ConnDuelView extends PvpViewBase {
  kind: "connections";
  /** While the race is on: when it starts, and when it ends at the latest. */
  round?: { startsAt: number; endsAt: number };
  /** The sixteen Pokémon, once the race has started. */
  tiles?: ConnTile[];
  /** One per seat, once the race has begun. */
  boards: ConnDuelBoard[];
  /** Your own guesses and the groups you found (seated trainers only). */
  mine?: ConnDuelMine;
  /** After the end only: all four groups, explained. */
  reveal?: ConnGroupExplained[];
  /** After the end only: each seat's guesses as group colours. */
  rows?: ConnLevel[][][];
}

/** A Pikadoku Tic Tac Toe duel: seat 0 plays X, seat 1 plays O. Never carries a cell's valid answers. */
export interface PdkDuelView extends PvpViewBase {
  kind: "pikadoku";
  settings: { turnSecs: number; families: string[] };
  round?: { startsAt: number };
  /** The six categories, once play starts. */
  grid?: PdkGridView;
  /** Per cell: the seat that owns it, or null. */
  owners: (0 | 1 | null)[];
  /** Per cell: the Pokémon id claimed there. */
  picks: (number | null)[];
  /** Whose turn it is (a seat), and when it runs out. */
  turn: 0 | 1;
  turnEndsAt?: number;
  /** The winning row, once there is one. */
  line: number[] | null;
  last?: { seat: number; cell: number; id: number; hit: boolean; at: number };
}

export type PvpView = DleDuelView | QuizDuelView | ConnDuelView | PdkDuelView;

/** Creating, joining or rematching a duel: its code, your seat's token and the duel. */
export interface PvpSeatResponse {
  code: string;
  token: string;
  view: PvpView;
}

/** Where each kind of duel is played. */
export const pvpHref = (kind: PvpKind, code: string) => `/${kind}/duel/${code}`;
