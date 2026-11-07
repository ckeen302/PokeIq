import { mulberry32 } from "@/lib/race/tournament";
import { FORM } from "./constants";

/**
 * Seeded randomness for the Games. Every draw comes from (seed, event,
 * athlete, attempt), never from the order the field was listed in, so a
 * share link replays exactly and an athlete's day doesn't change because
 * someone else joined the event. Pure and unit-tested.
 */

/** FNV-1a, 32-bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A generator for one thing that happens: hash the parts with the seed. */
export function rngFor(seed: number, ...parts: (string | number)[]): () => number {
  return mulberry32(hash(`${seed}|${parts.join("|")}`));
}

/** A bell-shaped draw in [−1, 1] (the sum of three uniforms). */
export function bell(rnd: () => number): number {
  return (rnd() + rnd() + rnd() - 1.5) / 1.5;
}

/** Day-to-day form: a factor within ±1.5%. */
export function formFactor(rnd: () => number, spread: number = FORM.spread): number {
  return 1 + spread * bell(rnd);
}

/** A standard normal draw clipped to ±2.5 (Box–Muller). */
export function normal(rnd: () => number): number {
  const u = Math.max(1e-12, rnd()), v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(-2.5, Math.min(2.5, z));
}

/** A fresh random seed for a new draw (the page's "Again" button). */
export const newSeed = () => 1 + Math.floor(Math.random() * 999_999);

export const DEFAULT_GAMES_SEED = 2026;
