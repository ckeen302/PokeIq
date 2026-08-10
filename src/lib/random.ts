/**
 * Randomness utilities (unbiased, Fisher–Yates based).
 *
 * All helpers draw from an AsyncLocalStorage-scoped RNG when one is active,
 * falling back to Math.random. Wrapping generation in `withSeededRng` makes
 * every engine fully deterministic — the mechanism behind the Daily Gauntlet,
 * where every player worldwide gets the same questions — without threading an
 * rng parameter through any engine code.
 *
 * Server-only (uses node:async_hooks); engines already run server-side only.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const rngStore = new AsyncLocalStorage<() => number>();

/** Uniform float in [0, 1) from the active RNG scope. */
export function rand01(): number {
  return (rngStore.getStore() ?? Math.random)();
}

/** Deterministic PRNG (mulberry32) — fast, well-distributed, 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a — stable 32-bit hash for seeding from strings (e.g. a date key). */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Run `fn` with every random.ts helper drawing from a seeded sequence. */
export function withSeededRng<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  return rngStore.run(mulberry32(seed), fn);
}

/** Integer in [min, max], inclusive. */
export function randInt(min: number, max: number): number {
  return Math.floor(rand01() * (max - min + 1)) + min;
}

/** In-place-safe shuffled copy (Fisher–Yates). */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand01() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Uniform random element. Throws on empty input. */
export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick() called with empty array");
  return items[Math.floor(rand01() * items.length)];
}

/** Up to n distinct elements, uniformly, order randomized. */
export function sample<T>(items: readonly T[], n: number): T[] {
  return shuffle(items).slice(0, n);
}
