import { decodeScores, encodeScores } from "./match";
import type { Profile } from "./types";

/**
 * This device's own result and a pending "compare with a friend": browser
 * storage only, no accounts. Every read tolerates a missing or blocked store.
 */

const LAST = "which-pokemon:last";
const PENDING = "which-pokemon:compare-with";

export function saveLastResult(scores: Profile): void {
  try {
    localStorage.setItem(LAST, encodeScores(scores));
  } catch {
    // Private mode or storage blocked: the result still lives in the URL.
  }
}

export function lastResult(): Profile | null {
  try {
    return decodeScores(localStorage.getItem(LAST));
  } catch {
    return null;
  }
}

/** A friend's result, kept until this player finishes the quiz. */
export function savePendingCompare(scores: Profile): void {
  try {
    sessionStorage.setItem(PENDING, encodeScores(scores));
  } catch {
    // Ignored: the compare page still works from its own link.
  }
}

export function pendingCompare(): Profile | null {
  try {
    return decodeScores(sessionStorage.getItem(PENDING));
  } catch {
    return null;
  }
}

export function clearPendingCompare(): void {
  try {
    sessionStorage.removeItem(PENDING);
  } catch {
    // Ignored.
  }
}
