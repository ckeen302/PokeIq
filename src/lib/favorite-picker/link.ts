import { TYPES, type TypeName } from "@/lib/tier-list/types";
import { fromB64Url, toB64Url } from "@/lib/share/link-bytes";
import { FORM_KINDS, POOL_CATEGORIES, type PoolConfig } from "./pool";

/**
 * A Favorite Pokémon Picker result and its link (?d=…): a versioned byte string in base64url, like the Shiny Pokémon
 * Maker's designs, so a link rebuilds the result with no database.
 *
 *   v1:  [1] version · u8 parts (bit0 top list, bit1 type chart, bit2 pool, bit3 opens on the type chart)
 *        top list:   u8 count (1–10) · each Pokémon · u16 shiny bits
 *        type chart: u24 filled slots (bit i = TYPES[i]) · each filled slot's Pokémon, in type order · u24 shiny bits
 *        pool:       u16 generations · u24 types · u8 category · u8 forms (lib/favorite-picker/pool)
 *   A Pokémon: a species as u16 National Dex number (under 0x8000); a form as 0x80 + its id's length, then its
 *   Showdown id in ASCII ("charizardmegax"), so a link keeps working when the roster grows.
 */

export const LINK_VERSION = 1;
export const TOP_MAX = 10;
const ID_MAX = 48;

/** A Pokémon in a link: a species' National Dex number, or a form's roster key. */
export type Ref = number | string;

export interface SlotRef {
  ref: Ref;
  shiny: boolean;
}

export interface SharedResult {
  top: SlotRef[];
  chart: Partial<Record<TypeName, SlotRef>>;
  pool: PoolConfig | null;
  /** The link opens on the type chart (it was shared from there). */
  chartFirst?: boolean;
}

function pushRef(b: number[], ref: Ref) {
  if (typeof ref === "number") b.push((ref >> 8) & 0x7f, ref & 255);
  else {
    const id = ref.slice(0, ID_MAX);
    b.push(0x80 | id.length, ...Array.from(id, (c) => c.charCodeAt(0)));
  }
}
const u24 = (b: number[], v: number) => b.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
const validRef = (r: Ref) => (typeof r === "number" ? Number.isInteger(r) && r > 0 && r < 0x8000 : /^[a-z0-9]{1,48}$/.test(r));

export function encodeResult(r: SharedResult): string {
  const top = r.top.filter((s) => validRef(s.ref)).slice(0, TOP_MAX);
  const chart = TYPES.map((t) => r.chart[t]).map((s) => (s && validRef(s.ref) ? s : undefined));
  const hasChart = chart.some(Boolean);
  const b: number[] = [LINK_VERSION, (top.length ? 1 : 0) | (hasChart ? 2 : 0) | (r.pool && top.length ? 4 : 0) | (hasChart && (r.chartFirst || !top.length) ? 8 : 0)];
  if (top.length) {
    b.push(top.length);
    let shiny = 0;
    top.forEach((s, i) => {
      pushRef(b, s.ref);
      if (s.shiny) shiny |= 1 << i;
    });
    b.push(shiny >> 8, shiny & 255);
  }
  if (hasChart) {
    let filled = 0, shiny = 0;
    chart.forEach((s, i) => {
      if (!s) return;
      filled |= 1 << i;
      if (s.shiny) shiny |= 1 << i;
    });
    u24(b, filled);
    for (const s of chart) if (s) pushRef(b, s.ref);
    u24(b, shiny);
  }
  if (r.pool && top.length) {
    b.push((r.pool.gens >> 8) & 255, r.pool.gens & 255);
    u24(b, r.pool.types);
    b.push(Math.max(0, POOL_CATEGORIES.indexOf(r.pool.cat)), r.pool.forms & 255);
  }
  return toB64Url(Uint8Array.from(b));
}

/** Reads a link's value; null for anything this picker didn't write (never throws). */
export function decodeResult(s: string | null | undefined): SharedResult | null {
  if (!s || s.length > 1600 || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b = fromB64Url(s);
  if (!b || b.length < 2 || b[0] !== LINK_VERSION) return null;
  const parts = b[1];
  if (parts & ~15 || !(parts & 3) || (parts & 4 && !(parts & 1)) || (parts & 8 && !(parts & 2)) || (parts & 2 && !(parts & 1) && !(parts & 8))) return null;
  let i = 2;
  const need = (n: number) => i + n <= b.length;
  const ref = (): Ref | null => {
    if (!need(1)) return null;
    const h = b[i];
    if (h & 0x80) {
      const len = h & 0x7f;
      if (!len || len > ID_MAX || !need(1 + len)) return null;
      const id = String.fromCharCode(...b.subarray(i + 1, i + 1 + len));
      i += 1 + len;
      return /^[a-z0-9]+$/.test(id) ? id : null;
    }
    if (!need(2)) return null;
    const d = (h << 8) | b[i + 1];
    i += 2;
    return d > 0 ? d : null;
  };
  const read24 = () => {
    const v = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    i += 3;
    return v;
  };
  const out: SharedResult = { top: [], chart: {}, pool: null, chartFirst: !!(parts & 8) };
  if (parts & 1) {
    if (!need(1)) return null;
    const n = b[i++];
    if (!n || n > TOP_MAX) return null;
    const refs: Ref[] = [];
    for (let k = 0; k < n; k++) {
      const r = ref();
      if (r === null) return null;
      refs.push(r);
    }
    if (!need(2)) return null;
    const shiny = (b[i] << 8) | b[i + 1];
    i += 2;
    if (shiny >> n) return null;
    out.top = refs.map((r, k) => ({ ref: r, shiny: !!((shiny >> k) & 1) }));
  }
  if (parts & 2) {
    if (!need(3)) return null;
    const filled = read24();
    if (!filled || filled >> TYPES.length) return null;
    const refs: (Ref | null)[] = [];
    for (let k = 0; k < TYPES.length; k++) {
      if (!((filled >> k) & 1)) {
        refs.push(null);
        continue;
      }
      const r = ref();
      if (r === null) return null;
      refs.push(r);
    }
    if (!need(3)) return null;
    const shiny = read24();
    if (shiny & ~filled) return null;
    TYPES.forEach((t, k) => {
      const r = refs[k];
      if (r !== null) out.chart[t] = { ref: r, shiny: !!((shiny >> k) & 1) };
    });
  }
  if (parts & 4) {
    if (!need(7)) return null;
    const gens = (b[i] << 8) | b[i + 1];
    i += 2;
    const types = read24();
    const cat = b[i++], forms = b[i++];
    if (gens >> 9 || types >> TYPES.length || cat >= POOL_CATEGORIES.length || forms >> FORM_KINDS.length) return null;
    out.pool = { gens, types, cat: POOL_CATEGORIES[cat], forms };
  }
  if (i !== b.length) return null;
  return out;
}

/** A roster key's link form, and back: species by number, forms by key. */
export interface RefCodec {
  ref(key: string): Ref | null;
  key(ref: Ref): string | null;
}

export function refCodec(mons: readonly { k: string; d: number; f?: string }[]): RefCodec {
  const toRef = new Map<string, Ref>();
  const byDex = new Map<number, string>();
  const forms = new Set<string>();
  for (const m of mons) {
    if (m.f) {
      toRef.set(m.k, m.k);
      forms.add(m.k);
    } else {
      toRef.set(m.k, m.d);
      if (!byDex.has(m.d)) byDex.set(m.d, m.k);
    }
  }
  return {
    ref: (k) => toRef.get(k) ?? null,
    key: (r) => (typeof r === "number" ? (byDex.get(r) ?? null) : forms.has(r) ? r : null),
  };
}
