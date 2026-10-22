import { dailyNumber } from "@/lib/daily";
import type { RunResult, ShareCard } from "@/lib/session-types";
import { SHARE_QUIZ_GRID, sharePath, type QuizShareResult, type ShareResult } from "./payload";
import { quizShareText } from "./text";

/**
 * Sharing a finished game, the same way everywhere: the text (./text), the
 * link that carries the result (./payload: /s/<payload>, or a quiz's signed
 * /c/ challenge) and its landing page and preview card (./view).
 */

export * from "./payload";
export * from "./text";
export * from "./view";

/** The result's own link on this site. Browser only. */
export function shareUrl(result: ShareResult): string {
  return `${window.location.origin}${sharePath(result)}`;
}

/** A quiz run's /c/ challenge link: the same questions for whoever opens it. Browser only. */
export function challengeUrl(shareToken: string): string {
  return `${window.location.origin}/c/${shareToken}`;
}

/** A finished quiz, Daily Challenge or PokéIQ Test run, as a share result. */
export function quizShareResult(result: RunResult, streak?: number): QuizShareResult {
  const { spec } = result;
  return {
    game: "quiz",
    module: spec.module,
    format: spec.format,
    ...(!spec.daily && spec.format !== "adaptive" && { difficulty: spec.difficulty }),
    ...(spec.daily && { daily: dailyNumber(spec.daily) }),
    correct: result.correct,
    total: result.total,
    pokeiq: result.pokeiq,
    score: result.score,
    ...(result.durationMs > 0 && { seconds: Math.round(result.durationMs / 1000) }),
    grid: result.grid,
    ...(spec.daily && streak && { streak }),
  };
}

/** A signed challenge card (/c/<token>) as a share result, for its landing page and preview. */
export function shareCardResult(card: ShareCard): QuizShareResult {
  return {
    game: "quiz",
    module: card.m,
    format: card.f,
    ...(!card.day && card.f !== "adaptive" && { difficulty: card.d }),
    ...(card.day && { daily: dailyNumber(card.day) }),
    correct: card.c,
    total: card.t,
    pokeiq: card.q,
    score: card.sc,
    grid: card.gr.slice(0, SHARE_QUIZ_GRID),
  };
}

/** A quiz run's share text, with its link. */
export function resultShareText(result: RunResult, url?: string, streak?: number): string {
  return quizShareText(quizShareResult(result, streak), url);
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/**
 * The system share sheet where the browser has one, else the clipboard.
 * "failed" means nothing reached the player's clipboard: show the text for
 * manual copying.
 */
export async function shareOrCopy(text: string, url?: string): Promise<ShareOutcome> {
  const full = shareText(text, url);
  const data = { text: full };
  if (typeof navigator.share === "function" && (typeof navigator.canShare !== "function" || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "cancelled";
      // Not allowed here (no user gesture, a permissions policy): copy instead.
    }
  }
  try {
    await navigator.clipboard.writeText(full);
    return "copied";
  } catch {
    return "failed";
  }
}

/** The exact text shareOrCopy shares, for the manual-copy fallback. */
export function shareText(text: string, url?: string): string {
  return url ? `${text}\n${url}` : text;
}
