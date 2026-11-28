import { sanitizeRun } from "@/lib/nuzlocke/storage";
import type { Run } from "@/lib/nuzlocke/run";

/** A run deleted from its page, kept for this tab's session so the front page can offer Undo. */
const KEY = "pokeiq:nuzlocke:deleted";

export function stashDeleted(run: Run) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    // No session storage: the delete just can't be undone.
  }
}

export function takeDeleted(): Run | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? sanitizeRun(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
