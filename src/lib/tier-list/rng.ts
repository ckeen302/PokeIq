/** Seeded randomness: the same seed gives the same draw on every device (a challenge link replays exactly). */

/** A 32-bit hash of a string (FNV-1a, then mixed). */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

/** mulberry32: a small, fast generator of floats in [0, 1). */
export function rng(seed: string | number): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher–Yates with the seeded generator). */
export function shuffled<T>(items: readonly T[], seed: string | number): T[] {
  const out = items.slice();
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `n` items drawn without repeats, in the order they were drawn. */
export function draw<T>(items: readonly T[], n: number, seed: string | number): T[] {
  return shuffled(items, seed).slice(0, Math.max(0, Math.min(n, items.length)));
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** A short random seed for a new draw ("k7m2qx"). */
export function newSeed(len = 6): string {
  let s = "";
  const bytes = new Uint8Array(len);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
