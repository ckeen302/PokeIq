/**
 * Trainer profile persisted in localStorage — games, accuracy, bests.
 * Client-only; every helper no-ops safely on the server.
 */
import type { LeaderboardCategory, QuizCategory } from "@/engines/types";

const STATS_KEY = "pokeiq-trainer-stats";

export interface TrainerStats {
  gamesPlayed: number;
  totalCorrect: number;
  totalAnswered: number;
  bestStreak: number;
  /** best classic score per category */
  bestScores: Partial<Record<QuizCategory, number>>;
  /** most questions survived in survival mode */
  survivalBest: number;
}

const EMPTY: TrainerStats = {
  gamesPlayed: 0,
  totalCorrect: 0,
  totalAnswered: 0,
  bestStreak: 0,
  bestScores: {},
  survivalBest: 0,
};

export function loadStats(): TrainerStats {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<TrainerStats>;
    return { ...EMPTY, ...parsed, bestScores: parsed.bestScores ?? {} };
  } catch {
    return EMPTY;
  }
}

export interface GameResult {
  category: LeaderboardCategory;
  mode: "classic" | "survival" | "daily";
  score: number;
  correctCount: number;
  totalQuestions: number;
  bestStreak: number;
}

export function recordGame(result: GameResult): TrainerStats {
  const stats = loadStats();
  const next: TrainerStats = {
    ...stats,
    gamesPlayed: stats.gamesPlayed + 1,
    totalCorrect: stats.totalCorrect + result.correctCount,
    totalAnswered: stats.totalAnswered + result.totalQuestions,
    bestStreak: Math.max(stats.bestStreak, result.bestStreak),
    bestScores: { ...stats.bestScores },
    survivalBest:
      result.mode === "survival"
        ? Math.max(stats.survivalBest, result.correctCount)
        : stats.survivalBest,
  };
  if (result.mode === "classic" && result.category !== "daily") {
    const category = result.category as QuizCategory;
    next.bestScores[category] = Math.max(
      stats.bestScores[category] ?? 0,
      result.score,
    );
  }
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    // storage full / private mode — stats are best-effort
  }
  return next;
}

export function accuracyOf(stats: TrainerStats): number {
  return stats.totalAnswered > 0
    ? Math.round((100 * stats.totalCorrect) / stats.totalAnswered)
    : 0;
}
