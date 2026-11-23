/**
 * A Shiny Pokémon Maker design and its link format.
 *
 * The design travels in the URL (?d=…): a versioned byte string, base64url. Every value is quantised to what the
 * bytes can hold as soon as it is set, so opening a link recreates exactly the same pixels.
 *
 *   v2:  [2] version · u16 species · u8 form · u8 flags · u8 style · u8 finish · u8 part count
 *        per part: u8 (bit0 source shiny, bit1 custom) + if custom: u16 hue · u8 lightness · u8 chroma · u8 contrast
 *        if flags.shades: u8 count, then per shade u8 slot + r g b
 *        if flags.name:   u8 byte length + UTF-8
 *   style: 0 Pixel · 1 3D (HOME render) · 2 Artwork · 3 Animated (the B/W animated sprite)
 *   v1 (still read): no style byte; flags bit0 meant 3D.
 *   flags: bit0 reserved · bit1 sparkle · bit2 glow · bits3-4 background · bit5 reserved · bit6 name · bit7 shades
 *   (v1: bit5 meant the animated sprite; it opens as the Animated style)
 */
import type { RGB } from "./color";
import { LAST_ID } from "./data";
import { cleanText, fromB64Url, toB64Url } from "@/lib/share/link-bytes";

export { fromB64Url, toB64Url };

export const DESIGN_VERSION = 2;
export const FINISHES = ["flat", "metallic", "pastel", "gradient", "holo", "galaxy"] as const;
export type Finish = (typeof FINISHES)[number];
export const BACKGROUNDS = ["glow", "plain", "none"] as const;
export type Background = (typeof BACKGROUNDS)[number];
/** Pixel (B/W sprite), 3D (Pokémon HOME render), Artwork (official artwork), Animated (the B/W animated sprite). */
export const STYLES = ["px", "hd", "art", "sd"] as const;
export type Style = (typeof STYLES)[number];

/** A part's chosen colour: the colour of its middle shade, plus how far apart its shades are (k = 1 as drawn). */
export interface PartColour {
  l: number;
  c: number;
  h: number;
  k: number;
}
export interface PartState {
  /** Which colours the part starts from: 0 normal, 1 official shiny. */
  src: 0 | 1;
  /** Its own colour, or null to keep the source's colours exactly. */
  col: PartColour | null;
}

export interface Design {
  id: number;
  form: number;
  style: Style;
  parts: PartState[];
  /** Expert mode: single shades set by hand (slot index → colour). */
  shades: Record<number, RGB>;
  finish: Finish;
  sparkle: boolean;
  glow: boolean;
  bg: Background;
  name: string;
}

export const MAX_C = 0.4;
export const NAME_MAX = 24;
const MAX_PARTS = 16;

/** Rounds a colour to exactly what a link can carry. */
export function quantise(c: PartColour): PartColour {
  const h = Math.round((((c.h % 360) + 360) % 360) / 360 * 65536) % 65536;
  const l = Math.round(Math.min(1, Math.max(0, c.l)) * 255);
  const cc = Math.round(Math.min(MAX_C, Math.max(0, c.c)) / MAX_C * 255);
  const k = Math.round(Math.min(255, Math.max(32, c.k * 128)));
  return { h: (h * 360) / 65536, l: l / 255, c: (cc / 255) * MAX_C, k: k / 128 };
}

export function newDesign(id: number, partCount: number, src: 0 | 1 = 1): Design {
  return {
    id,
    form: 0,
    style: "px",
    parts: Array.from({ length: partCount }, () => ({ src, col: null })),
    shades: {},
    finish: "flat",
    sparkle: false,
    glow: false,
    bg: "glow",
    name: "",
  };
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

/** Trims a design name to the allowed length and characters (no control characters, single spaces). */
export function cleanName(s: string): string {
  return cleanText(s, NAME_MAX);
}

export function encodeDesign(d: Design): string {
  const b: number[] = [DESIGN_VERSION, (d.id >> 8) & 255, d.id & 255, d.form & 255];
  const name = cleanName(d.name);
  const shades = Object.entries(d.shades).filter(([k]) => Number(k) >= 0 && Number(k) < 256);
  const flags =
    (d.sparkle ? 2 : 0) |
    (d.glow ? 4 : 0) |
    (Math.max(0, BACKGROUNDS.indexOf(d.bg)) << 3) |
    (name ? 64 : 0) |
    (shades.length ? 128 : 0);
  b.push(flags, Math.max(0, STYLES.indexOf(d.style)), Math.max(0, FINISHES.indexOf(d.finish)), d.parts.length);
  for (const p of d.parts) {
    b.push((p.src ? 1 : 0) | (p.col ? 2 : 0));
    if (p.col) {
      const q = quantise(p.col);
      const h = Math.round((q.h / 360) * 65536) % 65536;
      b.push(h >> 8, h & 255, Math.round(q.l * 255), Math.round((q.c / MAX_C) * 255), Math.round(q.k * 128));
    }
  }
  if (shades.length) {
    b.push(Math.min(255, shades.length));
    for (const [k, rgb] of shades.slice(0, 255)) b.push(Number(k), rgb[0] & 255, rgb[1] & 255, rgb[2] & 255);
  }
  if (name) {
    const bytes = enc.encode(name);
    b.push(bytes.length, ...bytes);
  }
  return toB64Url(Uint8Array.from(b));
}

/** Reads a design link's value; null for anything malformed (never throws). */
export function decodeDesign(s: string | null | undefined): Design | null {
  if (!s || s.length > 600 || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b = fromB64Url(s);
  if (!b) return null;
  let i = 0;
  const need = (n: number) => i + n <= b.length;
  const v = b[0];
  if (!need(7) || (v !== 1 && v !== DESIGN_VERSION)) return null;
  const id = (b[1] << 8) | b[2];
  if (id < 1 || id > LAST_ID) return null;
  const form = b[3], flags = b[4];
  i = 5;
  let style: Style;
  if (v === 1) style = flags & 1 ? "hd" : flags & 32 ? "sd" : "px";
  else {
    if (flags & 33 || b[i] >= STYLES.length) return null;
    style = STYLES[b[i++]];
  }
  if (!need(2)) return null;
  const fin = b[i++], n = b[i++];
  if (form !== 0 || fin >= FINISHES.length || n < 1 || n > MAX_PARTS) return null;
  const bgi = (flags >> 3) & 3;
  if (bgi >= BACKGROUNDS.length) return null;
  const parts: PartState[] = [];
  for (let p = 0; p < n; p++) {
    if (!need(1)) return null;
    const h = b[i++];
    if (h & ~3) return null;
    let col: PartColour | null = null;
    if (h & 2) {
      if (!need(5)) return null;
      const hv = (b[i] << 8) | b[i + 1];
      const k = b[i + 4];
      if (k < 32) return null;
      col = { h: (hv * 360) / 65536, l: b[i + 2] / 255, c: (b[i + 3] / 255) * MAX_C, k: k / 128 };
      i += 5;
    }
    parts.push({ src: (h & 1) as 0 | 1, col });
  }
  const shades: Record<number, RGB> = {};
  if (flags & 128) {
    if (!need(1)) return null;
    const m = b[i++];
    if (!m || !need(m * 4)) return null;
    for (let k = 0; k < m; k++, i += 4) shades[b[i]] = [b[i + 1], b[i + 2], b[i + 3]];
  }
  let name = "";
  if (flags & 64) {
    if (!need(1)) return null;
    const len = b[i++];
    if (!len || len > NAME_MAX * 4 || !need(len)) return null;
    try {
      name = dec.decode(b.subarray(i, i + len));
    } catch {
      return null;
    }
    i += len;
    if (cleanName(name) !== name || !name) return null;
  }
  if (i !== b.length) return null;
  return {
    id,
    form,
    style,
    parts,
    shades,
    finish: FINISHES[fin],
    sparkle: !!(flags & 2),
    glow: !!(flags & 4),
    bg: BACKGROUNDS[bgi],
    name,
  };
}

/** Whether a decoded design fits a species' data (part and shade counts). */
export function fitsSpecies(d: Design, partCount: number, slotCount: number): boolean {
  return d.parts.length === partCount && Object.keys(d.shades).every((k) => Number(k) < slotCount);
}
