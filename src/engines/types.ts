/** Unified contract every quiz engine must satisfy. */

export type Difficulty = "easy" | "medium" | "hard";

export type QuizCategory =
  | "whos-that"
  | "type-detective"
  | "move-master"
  | "stat-showdown";

export const QUIZ_CATEGORIES: readonly QuizCategory[] = [
  "whos-that",
  "type-detective",
  "move-master",
  "stat-showdown",
];

/** Leaderboards exist per module plus one for the Daily Gauntlet. */
export type LeaderboardCategory = QuizCategory | "daily";

/** How the client should render the question image. Never encodes the answer. */
export type ImageHint = "normal" | "silhouette" | "pixelated";

export interface QuizQuestion {
  question: string;
  /** 2–4 mutually distinct choices, exactly one correct */
  options: string[];
  correctAnswer: string;
  explanation: string;
  imageUrl?: string;
  imageHint?: ImageHint;
  /** Optional sprite per option (key must be one of `options`) — enables VS duels. */
  optionImages?: Record<string, string>;
  difficulty: Difficulty;
}

/**
 * What actually crosses the wire to the browser: the answer + explanation are
 * sealed into an opaque token and stripped from the payload.
 */
export interface ClientQuestion {
  id: string;
  question: string;
  options: string[];
  imageUrl?: string;
  imageHint?: ImageHint;
  optionImages?: Record<string, string>;
  difficulty: Difficulty;
  token: string;
}

export interface QuizEngine {
  category: QuizCategory;
  name: string;
  /** Compute one question live from PokéAPI. May throw; callers retry. */
  generate(difficulty: Difficulty): Promise<QuizQuestion>;
}

export interface CategoryMeta {
  category: QuizCategory;
  name: string;
  tagline: string;
  emoji: string;
  accent: string;
}

export const CATEGORY_META: Record<QuizCategory, CategoryMeta> = {
  "whos-that": {
    category: "whos-that",
    name: "Who's That Pokémon?",
    tagline: "The anime classic — name the shadow, then watch the reveal.",
    emoji: "👁️",
    accent: "from-amber-400 to-orange-500",
  },
  "type-detective": {
    category: "type-detective",
    name: "Type Detective",
    tagline: "Deduce types from weaknesses, resistances and immunities.",
    emoji: "🔍",
    accent: "from-emerald-400 to-teal-500",
  },
  "move-master": {
    category: "move-master",
    name: "Move Master",
    tagline: "Effects, learnsets and base power — know every move.",
    emoji: "⚡",
    accent: "from-sky-400 to-blue-500",
  },
  "stat-showdown": {
    category: "stat-showdown",
    name: "Stat Showdown",
    tagline: "Speed tiers and stat spreads — competitive knowledge wins.",
    emoji: "📊",
    accent: "from-fuchsia-400 to-purple-500",
  },
};

export function isQuizCategory(value: string): value is QuizCategory {
  return (QUIZ_CATEGORIES as readonly string[]).includes(value);
}

/** Per-question timer, tuned by difficulty. */
export function timerSeconds(difficulty: Difficulty): number {
  switch (difficulty) {
    case "easy":
      return 18;
    case "medium":
      return 15;
    case "hard":
      return 12;
  }
}

/** Score multiplier by difficulty. */
export function difficultyMultiplier(difficulty: Difficulty): number {
  switch (difficulty) {
    case "easy":
      return 1;
    case "medium":
      return 1.5;
    case "hard":
      return 2;
  }
}
