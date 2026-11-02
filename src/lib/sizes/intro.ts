/**
 * On a first visit /pokedex/sizes plays its cinematic glide by itself, with
 * the title card; later visits open in Explore with a Play button. Storage
 * can be missing or throw (private modes, blocked cookies), so it is read
 * and written in try/catch with an in-memory fallback. Client-safe and
 * unit-tested.
 */

export const INTRO_KEY = "pokeiq-sizes-intro";

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

/** Auto-play: not under reduced motion, not on a Pokémon's own link or a comparison (they came for that), and once. */
export function shouldAutoPlay(opts: { store: Store | null | undefined; reducedMotion: boolean; deepLink: boolean }): boolean {
  if (opts.reducedMotion || opts.deepLink) return false;
  return !introSeen(opts.store);
}

/** For tests: forget the in-memory fallback. */
export function resetIntroMemory(): void {
  seenFallback = false;
}
