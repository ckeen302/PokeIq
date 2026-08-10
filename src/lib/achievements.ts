/**
 * Gym Badges — Kanto-flavored achievements persisted in localStorage.
 * Evaluated when a run finishes; newly earned badges are surfaced as toasts.
 */

const BADGES_KEY = "pokeiq-badges";

export interface BadgeContext {
  mode: "classic" | "survival" | "daily";
  difficulty: string;
  score: number;
  maxPossible: number;
  correctCount: number;
  totalQuestions: number;
  bestStreak: number;
}

export interface BadgeDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  earned: (ctx: BadgeContext) => boolean;
}

export const BADGES: BadgeDef[] = [
  {
    id: "boulder",
    name: "Boulder Badge",
    emoji: "🪨",
    description: "Complete your first run",
    earned: (c) => c.totalQuestions > 0,
  },
  {
    id: "cascade",
    name: "Cascade Badge",
    emoji: "💧",
    description: "Get 8+ correct in a single run",
    earned: (c) => c.correctCount >= 8,
  },
  {
    id: "thunder",
    name: "Thunder Badge",
    emoji: "⚡",
    description: "Hit a 5-answer streak",
    earned: (c) => c.bestStreak >= 5,
  },
  {
    id: "rainbow",
    name: "Rainbow Badge",
    emoji: "🌈",
    description: "Earn an S grade",
    earned: (c) => c.maxPossible > 0 && c.score / c.maxPossible >= 0.9,
  },
  {
    id: "soul",
    name: "Soul Badge",
    emoji: "👻",
    description: "Survive 10 questions in Survival",
    earned: (c) => c.mode === "survival" && c.correctCount >= 10,
  },
  {
    id: "marsh",
    name: "Marsh Badge",
    emoji: "🔮",
    description: "Complete a run on hard",
    earned: (c) => c.difficulty === "hard" && c.totalQuestions > 0,
  },
  {
    id: "volcano",
    name: "Volcano Badge",
    emoji: "🔥",
    description: "Score 250+ points in one run",
    earned: (c) => c.score >= 250,
  },
  {
    id: "earth",
    name: "Earth Badge",
    emoji: "🌍",
    description: "A perfect run — 100% accuracy",
    earned: (c) => c.totalQuestions >= 5 && c.correctCount === c.totalQuestions,
  },
];

export function loadEarnedBadges(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(BADGES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Evaluate a finished run; persists and returns any newly earned badges. */
export function evaluateBadges(ctx: BadgeContext): BadgeDef[] {
  const earned = loadEarnedBadges();
  const fresh = BADGES.filter((b) => !earned.has(b.id) && b.earned(ctx));
  if (fresh.length > 0) {
    for (const badge of fresh) earned.add(badge.id);
    try {
      window.localStorage.setItem(BADGES_KEY, JSON.stringify([...earned]));
    } catch {
      // best-effort persistence
    }
  }
  return fresh;
}
