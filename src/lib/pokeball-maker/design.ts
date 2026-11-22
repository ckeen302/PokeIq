/**
 * A Poké Ball Maker design and its link format.
 *
 * The design travels in the URL (?d=…) as a versioned byte string written in base64url (src/lib/share/link-bytes).
 * Colours are sRGB bytes, so a link recreates exactly the same ball. The decoder never throws: anything malformed,
 * out of range or with bytes left over is null.
 *
 *   v1:  [1] version · u8 flags
 *        6 × rgb             part colours: top, bottom, band, button ring, button, inside
 *        6 × u8              part finishes (FINISHES)
 *        2 × pattern         top half, bottom half: u8 id, and when id > 0: 3 × rgb · u8 scale · u8 rotation
 *        u8 shape            bits 0-1 shape (SHAPES), bits 2-3 button (BUTTONS)
 *        u8 band             band thickness, 0..255
 *        if flags.effect:    u8 kind (EFFECTS, not 0) · 3 × rgb
 *        if flags.stickers:  u8 count (1..MAX_STICKERS), per sticker u8 glyph · u16 azimuth · u16 polar · u8 size ·
 *                            u8 rotation · rgb
 *        if flags.inside:    u16 National Dex number · u8 (bit0 shiny)
 *        if flags.shiny:     u8 length + a Shiny Pokémon Maker design's bytes (needs flags.inside)
 *        if flags.name:      u8 length + UTF-8
 *        if flags.desc:      u8 length + UTF-8
 *   flags: bit0 name · bit1 desc · bit2 inside · bit3 stickers · bit4 effect · bit5 shiny design · bits 6-7 zero
 */
import { cleanText, fromB64Url, toB64Url } from "@/lib/share/link-bytes";
import { PATTERN_COUNT } from "./patterns";
import { GLYPH_COUNT } from "./glyphs";

export const DESIGN_VERSION = 1;
export const LAST_ID = 1025;

export type RGB = [number, number, number];

export const PARTS = ["top", "bottom", "band", "ring", "button", "inner"] as const;
export type Part = (typeof PARTS)[number];

export const FINISHES = ["gloss", "matte", "metal", "pearl", "holo", "glitter", "glass", "wood", "stone", "carbon", "glow"] as const;
export type Finish = (typeof FINISHES)[number];

export const SHAPES = ["classic", "hisui", "faceted"] as const;
export type Shape = (typeof SHAPES)[number];

export const BUTTONS = ["classic", "gem", "glow", "latch"] as const;
export type ButtonStyle = (typeof BUTTONS)[number];

export const EFFECTS = ["none", "hearts", "stars", "fire", "bubbles", "lightning", "petals", "confetti", "smoke"] as const;
export type Effect = (typeof EFFECTS)[number];

export const MAX_STICKERS = 12;
export const NAME_MAX = 24;
export const DESC_MAX = 120;
/** The longest link value read (a full design with a Shiny Maker design inside is well under this). */
export const LINK_MAX = 1600;

export interface PatternLayer {
  /** Index into PATTERNS (0: none). */
  id: number;
  colours: [RGB, RGB, RGB];
  /** 0..255 (the shader maps it to 0.5×..2.5×; 102 is 1×). */
  scale: number;
  /** 0..255 (a full turn). */
  rot: number;
}

export interface Sticker {
  glyph: number;
  /** Where on the ball: azimuth from the button (0..65535 a full turn) and polar angle from the top (0..65535 = 0..π). */
  az: number;
  pol: number;
  /** 0..255 (small to large). */
  size: number;
  /** 0..255 (a full turn). */
  rot: number;
  colour: RGB;
}

export interface Design {
  colours: Record<Part, RGB>;
  finishes: Record<Part, Finish>;
  patterns: { top: PatternLayer; bottom: PatternLayer };
  shape: Shape;
  button: ButtonStyle;
  /** 0..255: a thin band to a broad one. */
  band: number;
  effect: { kind: Effect; colours: [RGB, RGB, RGB] };
  stickers: Sticker[];
  /** The Pokémon inside (0: none), shiny, and a Shiny Pokémon Maker design's bytes (its colours) or null. */
  inside: { id: number; shiny: boolean; custom: Uint8Array | null };
  name: string;
  desc: string;
}

export const cleanName = (s: string) => cleanText(s, NAME_MAX);
export const cleanDesc = (s: string) => cleanText(s, DESC_MAX);

export const noPattern = (): PatternLayer => ({ id: 0, colours: [[255, 255, 255], [32, 32, 36], [230, 40, 50]], scale: 102, rot: 0 });

/** A plain ball (white halves, black band, white button): the blank starting point. */
export function blankDesign(): Design {
  return {
    colours: { top: [246, 246, 242], bottom: [246, 246, 242], band: [28, 28, 32], ring: [28, 28, 32], button: [250, 250, 248], inner: [52, 52, 58] },
    finishes: { top: "gloss", bottom: "gloss", band: "matte", ring: "gloss", button: "gloss", inner: "matte" },
    patterns: { top: noPattern(), bottom: noPattern() },
    shape: "classic",
    button: "classic",
    band: 96,
    effect: { kind: "none", colours: [[255, 255, 255], [255, 214, 90], [255, 120, 160]] },
    stickers: [],
    inside: { id: 0, shiny: false, custom: null },
    name: "",
    desc: "",
  };
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const b = (v: number) => Math.max(0, Math.min(255, Math.round(v))) | 0;
const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v))) | 0;

export function encodeDesign(d: Design): string {
  const name = cleanName(d.name);
  const desc = cleanDesc(d.desc);
  const stickers = d.stickers.slice(0, MAX_STICKERS);
  const inside = d.inside.id >= 1 && d.inside.id <= LAST_ID;
  const custom = inside && d.inside.custom && d.inside.custom.length > 0 && d.inside.custom.length < 256 ? d.inside.custom : null;
  const effect = d.effect.kind !== "none";
  const flags = (name ? 1 : 0) | (desc ? 2 : 0) | (inside ? 4 : 0) | (stickers.length ? 8 : 0) | (effect ? 16 : 0) | (custom ? 32 : 0);
  const out: number[] = [DESIGN_VERSION, flags];
  const rgb = (c: RGB) => out.push(b(c[0]), b(c[1]), b(c[2]));
  for (const p of PARTS) rgb(d.colours[p]);
  for (const p of PARTS) out.push(Math.max(0, FINISHES.indexOf(d.finishes[p])));
  for (const layer of [d.patterns.top, d.patterns.bottom]) {
    const id = layer.id > 0 && layer.id < PATTERN_COUNT ? layer.id : 0;
    out.push(id);
    if (id) {
      layer.colours.forEach(rgb);
      out.push(b(layer.scale), b(layer.rot));
    }
  }
  out.push(Math.max(0, SHAPES.indexOf(d.shape)) | (Math.max(0, BUTTONS.indexOf(d.button)) << 2), b(d.band));
  if (effect) {
    out.push(EFFECTS.indexOf(d.effect.kind));
    d.effect.colours.forEach(rgb);
  }
  if (stickers.length) {
    out.push(stickers.length);
    for (const s of stickers) {
      const az = u16(s.az), pol = u16(s.pol);
      out.push(Math.min(GLYPH_COUNT - 1, b(s.glyph)), az >> 8, az & 255, pol >> 8, pol & 255, b(s.size), b(s.rot));
      rgb(s.colour);
    }
  }
  if (inside) out.push(d.inside.id >> 8, d.inside.id & 255, d.inside.shiny ? 1 : 0);
  if (custom) out.push(custom.length, ...custom);
  for (const text of [name, desc]) {
    if (!text) continue;
    const bytes = enc.encode(text);
    out.push(bytes.length, ...bytes);
  }
  return toB64Url(Uint8Array.from(out));
}

/** Reads a design link's value; null for anything malformed (never throws). */
export function decodeDesign(s: string | null | undefined): Design | null {
  try {
    return read(s);
  } catch {
    return null;
  }
}

function read(s: string | null | undefined): Design | null {
  if (!s || s.length > LINK_MAX || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const bytes = fromB64Url(s);
  if (!bytes || bytes.length < 2 || bytes[0] !== DESIGN_VERSION) return null;
  let i = 2;
  const flags = bytes[1];
  if (flags & 0xc0) return null;
  if (flags & 32 && !(flags & 4)) return null;
  const need = (n: number) => i + n <= bytes.length;
  const rgb = (): RGB => {
    const c: RGB = [bytes[i], bytes[i + 1], bytes[i + 2]];
    i += 3;
    return c;
  };
  if (!need(PARTS.length * 4)) return null;
  const colours = {} as Record<Part, RGB>;
  for (const p of PARTS) colours[p] = rgb();
  const finishes = {} as Record<Part, Finish>;
  for (const p of PARTS) {
    const f = bytes[i++];
    if (f >= FINISHES.length) return null;
    finishes[p] = FINISHES[f];
  }
  const layers: PatternLayer[] = [];
  for (let k = 0; k < 2; k++) {
    if (!need(1)) return null;
    const id = bytes[i++];
    if (id >= PATTERN_COUNT) return null;
    if (!id) {
      layers.push(noPattern());
      continue;
    }
    if (!need(11)) return null;
    const cs: [RGB, RGB, RGB] = [rgb(), rgb(), rgb()];
    layers.push({ id, colours: cs, scale: bytes[i], rot: bytes[i + 1] });
    i += 2;
  }
  if (!need(2)) return null;
  const sh = bytes[i++], band = bytes[i++];
  if (sh & 0xf0 || (sh & 3) >= SHAPES.length) return null;
  const shape = SHAPES[sh & 3], button = BUTTONS[(sh >> 2) & 3];
  const effect: Design["effect"] = { kind: "none", colours: blankDesign().effect.colours };
  if (flags & 16) {
    if (!need(10)) return null;
    const k = bytes[i++];
    if (k < 1 || k >= EFFECTS.length) return null;
    effect.kind = EFFECTS[k];
    effect.colours = [rgb(), rgb(), rgb()];
  }
  const stickers: Sticker[] = [];
  if (flags & 8) {
    if (!need(1)) return null;
    const n = bytes[i++];
    if (n < 1 || n > MAX_STICKERS || !need(n * 10)) return null;
    for (let k = 0; k < n; k++) {
      const glyph = bytes[i];
      if (glyph >= GLYPH_COUNT) return null;
      const az = (bytes[i + 1] << 8) | bytes[i + 2], pol = (bytes[i + 3] << 8) | bytes[i + 4];
      const size = bytes[i + 5], rot = bytes[i + 6];
      i += 7;
      stickers.push({ glyph, az, pol, size, rot, colour: rgb() });
    }
  }
  const inside: Design["inside"] = { id: 0, shiny: false, custom: null };
  if (flags & 4) {
    if (!need(3)) return null;
    const id = (bytes[i] << 8) | bytes[i + 1], f = bytes[i + 2];
    i += 3;
    if (id < 1 || id > LAST_ID || f & ~1) return null;
    inside.id = id;
    inside.shiny = !!(f & 1);
  }
  if (flags & 32) {
    if (!need(1)) return null;
    const n = bytes[i++];
    if (!n || !need(n)) return null;
    inside.custom = bytes.slice(i, i + n);
    i += n;
  }
  const texts: string[] = [];
  for (const [bit, max, clean] of [[1, NAME_MAX, cleanName], [2, DESC_MAX, cleanDesc]] as const) {
    if (!(flags & bit)) {
      texts.push("");
      continue;
    }
    if (!need(1)) return null;
    const n = bytes[i++];
    if (!n || n > max * 4 || !need(n)) return null;
    const text = dec.decode(bytes.subarray(i, i + n));
    i += n;
    if (!text || clean(text) !== text) return null;
    texts.push(text);
  }
  if (i !== bytes.length) return null;
  return { colours, finishes, patterns: { top: layers[0], bottom: layers[1] }, shape, button, band, effect, stickers, inside, name: texts[0], desc: texts[1] };
}

/** A deep copy (designs are replaced, never changed in place, but presets hand out shared arrays). */
export function cloneDesign(d: Design): Design {
  const c = (x: RGB): RGB => [x[0], x[1], x[2]];
  const layer = (l: PatternLayer): PatternLayer => ({ ...l, colours: [c(l.colours[0]), c(l.colours[1]), c(l.colours[2])] });
  return {
    ...d,
    colours: Object.fromEntries(PARTS.map((p) => [p, c(d.colours[p])])) as Record<Part, RGB>,
    finishes: { ...d.finishes },
    patterns: { top: layer(d.patterns.top), bottom: layer(d.patterns.bottom) },
    effect: { kind: d.effect.kind, colours: [c(d.effect.colours[0]), c(d.effect.colours[1]), c(d.effect.colours[2])] },
    stickers: d.stickers.map((s) => ({ ...s, colour: c(s.colour) })),
    inside: { ...d.inside, custom: d.inside.custom ? d.inside.custom.slice() : null },
  };
}

export const hexOf = (c: RGB) => "#" + c.map((v) => b(v).toString(16).padStart(2, "0")).join("");
export function rgbOf(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The pattern scale and rotation as the shader takes them. */
export const patternScale = (v: number) => 0.5 + (v / 255) * 2.5;
export const patternRot = (v: number) => (v / 256) * Math.PI * 2;
/** A sticker's place as angles (radians) and its size as a share of the ball's radius. */
export const stickerAngles = (s: Sticker) => ({ az: (s.az / 65536) * Math.PI * 2, pol: (s.pol / 65535) * Math.PI });
export const stickerSize = (v: number) => 0.12 + (v / 255) * 0.5;
/** Band height in mm on the 60 mm ball. */
export const bandHeight = (v: number) => 2.4 + (v / 255) * 7.6;
