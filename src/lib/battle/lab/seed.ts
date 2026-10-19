/**
 * Reproducible runs. A run has one master seed (a short string anyone can
 * read, copy or type); battle `i` of the run gets its own simulator seed
 * and its own strategy dice, both derived from (master seed, i) alone. So
 * the same master seed replays the same battles, whichever worker runs them
 * and in whatever order, and any single battle can be re-run on its own
 * (that's how "Watch a sample battle" gets its log).
 */

const SEED_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const SEED_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** A fresh 8-character master seed. */
export function newMasterSeed(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => SEED_CHARS[b % SEED_CHARS.length]).join("");
}

/** A typed-in seed, kept to letters, digits, "-" and "_" (null if nothing usable is left). */
export function cleanMasterSeed(input: string): string | null {
  const cleaned = input.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return SEED_RE.test(cleaned) ? cleaned : null;
}

/** cyrb128: four well-mixed 32-bit words from a string. */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * The simulator seed for battle `index` of a run: four 16-bit numbers, the
 * form Showdown's own seeds take ("1234,5678,9012,3456", its Gen 5 RNG).
 */
export function battleSeed(master: string, index: number): string {
  return hash128(`${master}:${index}`)
    .map((h) => (h >>> 16) ^ (h & 0xffff))
    .join(",");
}

/** A small deterministic generator (0 ≤ x < 1) for one side's strategy in one battle. */
export function strategyRandom(master: string, index: number, side: 0 | 1): () => number {
  let [a, b, c, d] = hash128(`${master}:${index}:${side === 0 ? "a" : "b"}`);
  // sfc32
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
