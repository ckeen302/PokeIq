import type { Difficulty, ModuleId, QuizFormat } from "@/engines/types";

/** Wire types shared by the session API and the client. No answers in here. */

export interface SessionSpec {
  module: ModuleId;
  format: QuizFormat;
  difficulty: Difficulty;
  gens?: number[];
  /** Public seed id. Question content is HMAC(secret, seed)-derived. */
  seed: string;
  /** Local date (YYYY-MM-DD) for Daily Challenge runs. */
  daily?: string;
}

export interface PublicQuestion {
  index: number;
  module: Exclude<ModuleId, "mixed">;
  prompt: string;
  detail?: string;
  options: string[];
  media?: { type: "image" | "audio"; url: string; zoom?: boolean };
  cards?: { label: string; imageUrl: string }[];
  timeLimitMs: number | null;
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
  /** Adaptive test only: rating standard error and per-step [rating, se] estimates. */
  se?: number;
  trajectory?: [number, number][];
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
  /** Skill tags for the weak-spot coach, e.g. ["mod:dex", "gen:3", "type:fire"]. */
  tags: string[];
  gained: number;
  score: number;
  streak: number;
  lives: number | null;
  answered: number;
  token: string;
  done: boolean;
  next?: PublicQuestion;
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
