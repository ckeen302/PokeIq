/**
 * The Shiny Pokémon Maker's per-species data (public/shiny-maker/px/{id}.json, built offline by
 * scripts/shiny-maker/build.ts) and its decoding. Loaded one species at a time, on demand.
 */
import { rgbToLch, type LCH, type RGB } from "./color";

export const DATA_VERSION = 1;
export const LAST_ID = 1025;
export const DATA_BASE = "/shiny-maker";

export interface PartDef {
  /** Display name ("Body", "Wings", or a generic "Main", "Accent"…). */
  n: string;
  /** Slot indices. */
  s: number[];
  /** The outline (only edited in Expert mode; Randomise leaves it). */
  o?: 1;
}

/** HD reference colours of a part (from the HOME renders): normal and shiny, [l, c, h] each. */
export type HdRef = [number, number, number, number, number, number];

export interface SpeciesFile {
  v: number;
  id: number;
  name: string;
  types: string[];
  /** Cropped sprite size. */
  w: number;
  h: number;
  /** Palette slots: "rrggbb:rrggbb" (normal colour : official shiny colour). */
  slots: string[];
  /** Pixel indices, run-length coded (value, run) byte pairs, base64: 0 transparent, k = slot k − 1. */
  px: string;
  parts: PartDef[];
  /** Whether the slots' shiny colours reproduce the official shiny sprite exactly. */
  exact: boolean;
  /** Has an animated B/W sprite. */
  anim?: 1;
  /** 3D: HOME-render label mask (public/shiny-maker/hd/{id}.png) and its per-part reference colours. */
  hd?: HdRef[];
  /** Artwork: official-artwork label mask (public/shiny-maker/art/{id}.png) and its reference colours. */
  art?: HdRef[];
}

export interface Slot {
  normal: RGB;
  shiny: RGB;
  nl: LCH;
  sl: LCH;
  count: number;
}

export interface Species {
  id: number;
  name: string;
  types: string[];
  w: number;
  h: number;
  /** Per pixel: −1 transparent, else slot index. */
  index: Int16Array;
  slots: Slot[];
  parts: PartDef[];
  /** Part of each slot. */
  partOf: Int16Array;
  exact: boolean;
  anim: boolean;
  hd: HdRef[] | null;
  art: HdRef[] | null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function b64decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}
export function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return s;
}

export function rleEncode(index: ArrayLike<number>): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < index.length; ) {
    const v = index[i];
    let run = 1;
    while (i + run < index.length && index[i + run] === v && run < 255) run++;
    out.push(v, run);
    i += run;
  }
  return Uint8Array.from(out);
}

export function rleDecode(bytes: Uint8Array, size: number): Int16Array {
  const out = new Int16Array(size).fill(-1);
  let o = 0;
  for (let i = 0; i + 1 < bytes.length && o < size; i += 2) {
    const v = bytes[i] - 1;
    for (let k = 0; k < bytes[i + 1] && o < size; k++) out[o++] = v;
  }
  return out;
}

const rgbOf = (h: string): RGB => {
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Checks and decodes a species file; throws on anything malformed. */
export function decodeSpecies(f: SpeciesFile): Species {
  if (!f || f.v !== DATA_VERSION || !Number.isInteger(f.id) || f.id < 1 || f.id > LAST_ID) throw new Error("bad species data");
  if (!(f.w > 0 && f.h > 0 && f.w <= 256 && f.h <= 256) || !Array.isArray(f.slots) || !Array.isArray(f.parts) || !f.parts.length) throw new Error("bad species data");
  const index = rleDecode(b64decode(f.px), f.w * f.h);
  const slots: Slot[] = f.slots.map((s) => {
    const [a, b] = s.split(":");
    if (!/^[0-9a-f]{6}$/.test(a) || !/^[0-9a-f]{6}$/.test(b)) throw new Error("bad slot");
    const normal = rgbOf(a), shiny = rgbOf(b);
    return { normal, shiny, nl: rgbToLch(...normal), sl: rgbToLch(...shiny), count: 0 };
  });
  for (const v of index) if (v >= 0) {
    if (v >= slots.length) throw new Error("bad pixel");
    slots[v].count++;
  }
  const partOf = new Int16Array(slots.length).fill(-1);
  f.parts.forEach((p, i) => p.s.forEach((s) => { if (s >= 0 && s < slots.length) partOf[s] = i; }));
  // Every slot belongs to a part (the build guarantees it; a stray one joins the first).
  for (let i = 0; i < partOf.length; i++) if (partOf[i] < 0) partOf[i] = 0;
  return {
    id: f.id,
    name: f.name,
    types: f.types,
    w: f.w,
    h: f.h,
    index,
    slots,
    parts: f.parts,
    partOf,
    exact: !!f.exact,
    anim: !!f.anim,
    hd: f.hd && f.hd.length === f.parts.length ? f.hd : null,
    art: f.art && f.art.length === f.parts.length ? f.art : null,
  };
}

const cache = new Map<number, Promise<Species>>();
/** Fetches one species' data (cached for the session). */
export function loadSpecies(id: number): Promise<Species> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`${DATA_BASE}/px/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`species ${id}: ${r.status}`);
        return r.json() as Promise<SpeciesFile>;
      })
      .then(decodeSpecies);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** The species list for the picker: [id, name, primary type] (public/shiny-maker/species.json). */
export type SpeciesEntry = [number, string, string];
let list: Promise<SpeciesEntry[]> | null = null;
export function loadSpeciesList(): Promise<SpeciesEntry[]> {
  list ??= fetch(`${DATA_BASE}/species.json`).then((r) => {
    if (!r.ok) throw new Error("species list");
    return r.json();
  });
  list.catch(() => (list = null));
  return list;
}
