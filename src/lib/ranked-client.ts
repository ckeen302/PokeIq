"use client";

/**
 * The browser's ranked id: the signed anonymous id the server gave it (kept
 * in localStorage; a signed-in trainer is their account instead). Ranked
 * PokéGuessr and the battle ladder know a trainer by it.
 */

const ID_KEY = "pokeiq-ranked-id";

export function rankedId(): string | null {
  try {
    return window.localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}

export function keepRankedId(id: string) {
  try {
    window.localStorage.setItem(ID_KEY, id);
  } catch {
    // Private mode: a new id next visit.
  }
}

/** What a ranked search sends with every poll: the browser's signed ranked id. */
export const rankedExtra = (): Record<string, unknown> => {
  const id = rankedId();
  return id ? { rankedId: id } : {};
};
