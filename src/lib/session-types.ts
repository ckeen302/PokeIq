import type { Difficulty, ModuleId, QuizFormat } from "@/engines/types";
import type { ZoomView, ZoomWindow } from "@/lib/zoom-reveal";

/** Wire types shared by the session API and the client. No answers in here. */

/**
 * Why a run can't be submitted to the leaderboard (it still plays, scores
 * and shares normally):
 * - "challenge":    replays a friend's exact quiz from a share link
 * - "repeat-daily": a second start of a Daily Challenge in the same browser
 * - "filtered":     a generation-filtered run (boards rank all-generation runs)
 * - "zoom-daily":   the one-Pokémon daily Zoom Reveal (shared, not a ranked run)
 */
export type PracticeReason = "challenge" | "repeat-daily" | "filtered" | "zoom-daily";

export interface SessionSpec {
  module: ModuleId;
  format: QuizFormat;
  difficulty: Difficulty;
  gens?: number[];
  /** Public seed id. Question content is HMAC(secret, seed)-derived. */
  seed: string;
  /** Local date (YYYY-MM-DD) for Daily Challenge runs. */
  daily?: string;
  /** Set (and signed) by the server when the run is unranked. */
  practice?: PracticeReason;
  /** Local date (YYYY-MM-DD) of a daily Zoom Reveal: one Pokémon, untimed. */
  zoomDaily?: string;
}

export interface PublicQuestion {
  index: number;
  module: Exclude<ModuleId, "mixed">;
  prompt: string;
  detail?: string;
  options: string[];
  /** Image URL per option (same order), when the options are pictures. */
  images?: string[];
  media?: { type: "image" | "audio"; url: string; zoom?: boolean };
  cards?: { label: string; imageUrl: string }[];
  timeLimitMs: number | null;
  /** "name": no options, the player types a Pokémon's name (Zoom Reveal). */
  input?: "name";
  /** Zoom Reveal: the step in play and its crop. */
  zoom?: ZoomView;
}

export interface RunResult {
  sid: string;
  spec: SessionSpec;
  score: number;
  correct: number;
  total: number;
  bestStreak: number;
  /** "1" correct / "0" wrong per question, in order. */
  grid: string;
  durationMs: number;
  rating: number;
  pokeiq: number;
  finishedAt: number;
  /** Present when the run can't be submitted to the leaderboard; see PracticeReason. */
  practice?: PracticeReason;
  /** Zoom Reveal: the step each Pokémon was named on ("1".."6"), "X" for missed. */
  zoom?: string;
  /** Adaptive test only: rating standard error and per-step [rating, se] estimates. */
  se?: number;
  trajectory?: [number, number][];
}

export interface NextResponse {
  token: string;
  question: PublicQuestion;
}

export interface StartResponse {
  token: string;
  question: PublicQuestion;
  rules: { total: number | null; lives: number | null; questionMs: number | null; runMs: number | null };
  lives: number | null;
}

export interface AnswerResponse {
  correct: boolean;
  timedOut: boolean;
  answer: string;
  explanation?: string;
  revealUrl?: string;
  /** Pokédex page for the Pokémon behind this question (study link). */
  learnHref?: string;
  /** Trivia modes: the Bulbapedia page the answer was checked against. */
  sourceUrl?: string;
  /** Skill tags for the weak-spot coach, e.g. ["mod:dex", "gen:3", "type:fire"]. */
  tags: string[];
  gained: number;
  score: number;
  streak: number;
  lives: number | null;
  answered: number;
  token: string;
  done: boolean;
  /**
   * False when the request didn't log an answer — a Blitz "time's up" ping
   * or an answer that arrived after the run clock ran out. Don't count it
   * toward skill stats.
   */
  counted: boolean;
  /**
   * Timed formats (classic, survival, adaptive): the next question is not
   * included and its timer hasn't started. When the player is ready, POST
   * /api/session/next { token } to get { token, question } — the server
   * starts the question's clock at that moment.
   */
  awaitNext: boolean;
  /** Next question, included only for Blitz (which never pauses). */
  next?: PublicQuestion;
  /**
   * Zoom Reveal: a wrong name or a skip before the last step. The question
   * goes on, one step further out: nothing about the answer is included
   * (`answer` is empty) and the step's clock starts now.
   */
  zoom?: ZoomView;
  /** Zoom Reveal: the step the Pokémon was named on (or the last step, when missed). */
  step?: number;
  /** Zoom Reveal: where that step's crop sits in the whole artwork, for the reveal's zoom-out. */
  zoomFrom?: ZoomWindow;
  result?: RunResult;
  /** Proof of a server-graded run, required by the leaderboard. */
  resultToken?: string;
  /** Compact signed result for share / challenge links (/c/<token>). */
  shareToken?: string;
}

/** Short keys keep challenge URLs compact. */
export interface ShareCard {
  n?: string;
  m: ModuleId;
  f: QuizFormat;
  d: Difficulty;
  g?: number[];
  s: string;
  day?: string;
  sc: number;
  c: number;
  t: number;
  q: number;
  gr: string;
}
