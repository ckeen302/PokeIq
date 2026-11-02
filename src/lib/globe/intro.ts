/**
 * The globe's fly-in from space plays once per browser (the timeline's rule,
 * src/lib/timeline/intro.ts): storage is read and written in try/catch with
 * an in-memory fallback, and reduced motion skips it. Client-safe.
 */

export const GLOBE_INTRO_KEY = "pokeiq-globe-intro";

type Store = Pick<Storage, "getItem" | "setItem">;

let seenFallback = false;

export function globeIntroSeen(store: Store | null | undefined): boolean {
  if (seenFallback) return true;
  try {
    return store?.getItem(GLOBE_INTRO_KEY) === "1";
  } catch {
    return seenFallback;
  }
}

export function markGlobeIntroSeen(store: Store | null | undefined): void {
  seenFallback = true;
  try {
    store?.setItem(GLOBE_INTRO_KEY, "1");
  } catch {
    // remembered in memory for this page
  }
}

export function shouldPlayGlobeIntro(opts: { store: Store | null | undefined; reducedMotion: boolean }): boolean {
  if (opts.reducedMotion) return false;
  return !globeIntroSeen(opts.store);
}

/** For tests: forget the in-memory fallback. */
export function resetGlobeIntroMemory(): void {
  seenFallback = false;
}
