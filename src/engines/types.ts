import type { Rng } from "@/lib/rng";

/**
 * The unified question contract.
 *
 * Every module compiles Pokédex data down to `Question`, the only shape the
 * session layer and UI understand. Questions are pure functions of an Rng,
 * so the server never stores them — it re-derives question N from the
 * session seed when grading (see src/lib/server/session.ts).
 */

export const MODULES = ["whos-that", "cry", "dex", "types", "higher-lower", "games", "anime", "competitive", "mixed"] as const;
export type ModuleId = (typeof MODULES)[number];

export const FORMATS = ["classic", "survival", "blitz", "adaptive"] as const;
export type QuizFormat = (typeof FORMATS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Media the client may only reach through an opaque, encrypted token. */
export type MediaKind = "silhouette" | "silhouette-zoom" | "artwork" | "cry";

export interface MediaRef {
  kind: MediaKind;
  pokemonId: number;
}

/** A side-by-side card (Higher or Lower). Names are public, so art is too. */
export interface QuestionCard {
  pokemonId: number;
  label: string;
}

export interface Question {
  /** Stable item key used for difficulty calibration, e.g. "whos-that:25:zoom". */
  itemKey: string;
  module: Exclude<ModuleId, "mixed">;
  prompt: string;
  /** Supporting text shown under the prompt (e.g. a censored Pokédex entry). */
  detail?: string;
  media?: MediaRef;
  cards?: QuestionCard[];
  options: string[];
  answer: string;
  explanation?: string;
  /** Where the fact was checked (trivia modes), shown after answering. */
  source?: string;
  /** Shown after answering (e.g. the full-colour artwork). */
  revealMedia?: MediaRef;
  /** Prior item difficulty on the PokéIQ rating scale (≈ Elo). */
  rating: number;
}

export interface GenerateOptions {
  difficulty: Difficulty;
  gens?: number[];
  /** Pokémon ids already used this session — engines avoid repeats. */
  used: Set<number>;
}

/** A module builder returns null when it can't produce an unambiguous question. */
export type QuestionBuilder = (rng: Rng, opts: GenerateOptions) => Question | null;
