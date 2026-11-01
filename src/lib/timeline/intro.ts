/**
 * The timeline's opening flight plays once per browser. Storage can be
 * missing or throw (private modes, blocked cookies), so it is read and
 * written in try/catch with an in-memory fallback: then the intro plays once
 * per page load at most. Client-safe and unit-tested.
 */

export const INTRO_KEY = "pokeiq-timeline-intro";

type Store = Pick<Storage, "getItem" | "setItem">;

let seenFallback = false;

export function introSeen(store: Store | null | undefined): boolean {
  if (seenFallback) return true;
  try {
    return store?.getItem(INTRO_KEY) === "1";
  } catch {
    return seenFallback;
  }
}

export function markIntroSeen(store: Store | null | undefined): void {
  seenFallback = true;
  try {
    store?.setItem(INTRO_KEY, "1");
  } catch {
    // remembered in memory for this page
  }
}

/**
 * Whether to play the intro: not under reduced motion, not when the visitor
 * arrived on a shared entry (they came for that entry), and only once.
 */
export function shouldPlayIntro(opts: { store: Store | null | undefined; reducedMotion: boolean; deepLink: boolean }): boolean {
  if (opts.reducedMotion || opts.deepLink) return false;
  return !introSeen(opts.store);
}

/** For tests: forget the in-memory fallback. */
export function resetIntroMemory(): void {
  seenFallback = false;
}
