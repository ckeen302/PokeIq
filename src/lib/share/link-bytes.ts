/**
 * What the Tools tab's share links have in common: a design travels in the URL as a versioned byte string written in
 * base64url (no padding, one canonical spelling per byte string), and any text it carries (a name, a description) is
 * cleaned the same way before it is written and checked again when it is read. Used by the Shiny Pokémon Maker and
 * the Poké Ball Maker.
 */

/** Control characters, zero-width and direction marks, line separators. */
// eslint-disable-next-line no-control-regex
const INVISIBLE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]", "g");

/** Trims text to `max` characters (code points) with no control characters and single spaces. */
export function cleanText(s: string, max: number): string {
  const t = s.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return Array.from(t).slice(0, max).join("").trim();
}

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toB64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += A[(n >> 18) & 63] + A[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += A[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += A[n & 63];
  }
  return s;
}

/** The bytes of a base64url string, or null for anything that isn't one canonical spelling. */
export function fromB64Url(s: string): Uint8Array | null {
  if (s.length % 4 === 1) return null;
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = A.indexOf(ch);
    if (v < 0) return null;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  // Leftover bits must be zero (one canonical spelling per design).
  if (bits && (buf & ((1 << bits) - 1))) return null;
  return Uint8Array.from(out);
}
