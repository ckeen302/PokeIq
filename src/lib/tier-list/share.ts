import LZString from "lz-string";
import { BLIND_LENGTHS, validSlots } from "./blind";
import { BRACKET_SIZES, SEEDINGS, type BracketSize, type Seeding } from "./bracket";
import { MODES, TOP_LENGTHS, initialState, type Mode, type ToolState, type TopLength } from "./state";
import { getTemplate } from "./templates";
import type { Mon } from "./types";

/**
 * Share links: the result itself, compressed into the URL (?s=…, lz-string), so a link rebuilds exactly what was made
 * with no database. Only the mode on screen travels (a tier list link carries the tiers, not a half-played bracket).
 * Species are written as their National Dex number and forms as their Showdown id ("charizardmegax"), so a link
 * keeps working when the roster grows.
 */

export const SHARE_VERSION = 1;

export interface Codec {
  code(key: string): string;
  key(code: string): string | null;
}

export function makeCodec(mons: readonly Mon[]): Codec {
  const toCode = new Map<string, string>();
  const toKey = new Map<string, string>();
  for (const m of mons) {
    const c = m.f ? m.k : String(m.d);
    toCode.set(m.k, c);
    toKey.set(c, m.k);
  }
  return { code: (k) => toCode.get(k) ?? k, key: (c) => toKey.get(c) ?? null };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Bracket picks (0/1 each) packed six to a character. */
export function packBits(bits: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bits.length; i += 6) {
    let v = 0;
    for (let j = 0; j < 6; j++) if (bits[i + j] === 1) v |= 1 << j;
    out += B64[v];
  }
  return `${bits.length}.${out}`;
}

export function unpackBits(s: unknown): number[] | null {
  if (typeof s !== "string") return null;
  const m = /^(\d+)\.([A-Za-z0-9_-]*)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n > m[2].length * 6 || n > 4096) return null;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = B64.indexOf(m[2][Math.floor(i / 6)]);
    if (v < 0) return null;
    out.push((v >> i % 6) & 1);
  }
  return out;
}

type Payload = {
  v: number;
  t: string;
  m: number;
  a?: 1;
  s?: 1;
  n?: string;
  p?: string;
  x?: string;
  r?: [string, string, string][];
  b?: [number, number, string, string, string?];
  o?: [number, string, string[]?];
  l?: [number, string, number, string, string?, string?, string?];
};

const join = (codec: Codec, keys: readonly string[]) => keys.map((k) => codec.code(k)).join(".");
const split = (codec: Codec, s: unknown): string[] => (typeof s === "string" && s ? s.split(".").map((c) => codec.key(c)).filter((k): k is string => !!k) : []);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const slotsStr = (slots: readonly number[]) => slots.join(",");
const parseSlots = (s: unknown, length: number): number[] | null => {
  if (typeof s !== "string") return null;
  const slots = s.split(",").map(Number);
  return validSlots(slots, length) ? slots : null;
};

/** The link's state: the mode on screen and what it needs. */
export function encodeShare(state: ToolState, codec: Codec, opts: { mode?: Mode } = {}): string {
  const mode = opts.mode ?? state.mode;
  const p: Payload = { v: SHARE_VERSION, t: state.template, m: MODES.indexOf(mode) };
  if (state.art === "pixel") p.a = 1;
  if (state.shiny) p.s = 1;
  if (state.title) p.n = state.title.slice(0, 80);
  if (state.added.length) p.p = join(codec, state.added);
  if (state.removed.length) p.x = join(codec, state.removed);
  if (mode === "tier") p.r = state.tier.rows.map((r) => [r.label.slice(0, 40), r.color.replace(/^#/, ""), join(codec, r.items)]);
  if (mode === "bracket") {
    const b = state.bracket;
    p.b = [b.size, SEEDINGS.indexOf(b.seeding), b.seed, packBits(b.picks)];
    if (b.seeding === "manual") p.b.push(join(codec, b.manual));
  }
  if (mode === "top") {
    const t = state.top;
    const caps = t.items.map((k) => (t.captions[k] ?? "").slice(0, 80));
    p.o = [t.length, join(codec, t.items)];
    if (caps.some(Boolean)) p.o.push(caps);
  }
  if (mode === "blind") {
    const l = state.blind;
    p.l = [l.length, l.seed, l.source === "random" ? 1 : 0, slotsStr(l.slots)];
    if (l.name || l.vs) p.l.push(l.name ?? "");
    if (l.vs) p.l.push(slotsStr(l.vs.slots), l.vs.name);
  }
  return LZString.compressToEncodedURIComponent(JSON.stringify(p));
}

/** A link's state, on top of a fresh one for its template; null if it isn't a link this maker wrote. */
export function decodeShare(raw: string | null | undefined, codec: Codec): ToolState | null {
  if (!raw || raw.length > 20_000) return null;
  let p: Payload;
  try {
    const json = LZString.decompressFromEncodedURIComponent(raw);
    if (!json) return null;
    p = JSON.parse(json);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object" || p.v !== SHARE_VERSION || !getTemplate(p.t)) return null;
  const mode = MODES[p.m] ?? "tier";
  const base = initialState(p.t, typeof p.l?.[1] === "string" ? p.l[1] : typeof p.b?.[2] === "string" ? p.b[2] : "shared");
  const s: ToolState = {
    ...base,
    mode,
    art: p.a === 1 ? "pixel" : "hd",
    shiny: p.s === 1,
    title: str(p.n, 80),
    added: split(codec, p.p),
    removed: split(codec, p.x),
  };
  if (mode === "tier" && Array.isArray(p.r)) {
    const seen = new Set<string>();
    s.tier = {
      rows: p.r.slice(0, 20).map((row, i) => {
        const items = split(codec, Array.isArray(row) ? row[2] : "").filter((k) => !seen.has(k) && (seen.add(k), true));
        const color = Array.isArray(row) && /^[0-9a-f]{6}$/i.test(String(row[1])) ? `#${row[1]}` : base.tier.rows[i % 6].color;
        return { id: `t${i}`, label: str(Array.isArray(row) ? row[0] : "", 40), color, items };
      }),
    };
    if (!s.tier.rows.length) s.tier = base.tier;
  }
  if (mode === "bracket" && Array.isArray(p.b)) {
    const [size, seeding, seed, picks, manual] = p.b;
    s.bracket = {
      size: ([0, ...BRACKET_SIZES] as number[]).includes(size) ? (size as BracketSize) : 16,
      seeding: (SEEDINGS[seeding] ?? "random") as Seeding,
      seed: str(seed, 24) || base.bracket.seed,
      manual: split(codec, manual),
      picks: unpackBits(picks) ?? [],
      started: true,
    };
  }
  if (mode === "top" && Array.isArray(p.o)) {
    const [length, items, caps] = p.o;
    const len = ((TOP_LENGTHS as readonly number[]).includes(length) ? length : 10) as TopLength;
    const keys = [...new Set(split(codec, items))].slice(0, len);
    const captions: Record<string, string> = {};
    if (Array.isArray(caps)) keys.forEach((k, i) => caps[i] && (captions[k] = str(caps[i], 80)));
    s.top = { length: len, items: keys, captions };
  }
  if (mode === "blind" && Array.isArray(p.l)) {
    const [length, seed, src, slots, name, vsSlots, vsName] = p.l;
    const len = ((BLIND_LENGTHS as readonly number[]).includes(length) ? length : 10) as 5 | 10;
    const own = parseSlots(slots, len) ?? Array.from({ length: len }, () => -1);
    const vs = parseSlots(vsSlots, len);
    s.blind = {
      length: len,
      seed: str(seed, 24) || base.blind.seed,
      source: src === 1 ? "random" : "template",
      slots: own,
      name: str(name, 24) || undefined,
      ...(vs && { vs: { slots: vs, name: str(vsName, 24) } }),
    };
  }
  return s;
}
