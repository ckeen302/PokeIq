/**
 * Matching a picture of a Pokémon (its HOME render, its official artwork) to its Pixel parts:
 * each pixel goes to the part whose (normal colour, official shiny colour) pair is nearest in OKLab. Both colours
 * count, so parts that look alike normally but change differently as a shiny are told apart. The outline is left out
 * (only the Pixel sprites draw one). Used by the offline mask builder (scripts/shiny-maker/hd.ts).
 */
import { labDist, rgbToOklab } from "./color";
import type { HdRef } from "./data";

type Lab = [number, number, number];

export interface MatchPart {
  /** Normal colours of the part's shades. */
  n: Lab[];
  /** Official shiny colours of the same shades. */
  s: Lab[];
  outline: boolean;
  /** Share of the figure each shade covers (learnt palettes): a big cluster beats a stray small one on near ties. */
  w?: number[];
}

const hexLab = (h: string): Lab => {
  const n = parseInt(h, 16);
  return rgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255) as Lab;
};

/** Match data from a species file's slots ("rrggbb:rrggbb") and parts. */
export function matchParts(slots: string[], parts: { s: number[]; o?: 1 }[]): MatchPart[] {
  return parts.map((p) => {
    const n: Lab[] = [], s: Lab[] = [];
    for (const i of p.s) {
      const [a, b] = (slots[i] ?? "000000:000000").split(":");
      n.push(hexLab(a));
      s.push(hexLab(b));
    }
    return { n, s, outline: !!p.o };
  });
}

/** How much a shade's share of the figure counts: small clusters need to be clearly nearer to win. */
const sharePenalty = (w: number | undefined) => (w === undefined ? 0 : 0.015 * -Math.log10(w + 0.001));

/**
 * A matcher: (normal pixel, shiny pixel or null when the picture has no distinct shiny) → [part, distance].
 * Results are memoised per colour pair (pictures repeat colours a lot).
 */
/**
 * Normal colours weigh more than shiny ones: normal palettes agree across games, while some newer official shinies
 * (HOME, the artwork) differ from the B/W shiny palette.
 */
const MIX = (dn: number, ds: number) => 0.65 * dn + 0.35 * ds;

export function makeMatcher(parts: MatchPart[]) {
  const cand: { n: Lab; s: Lab; part: number; pen: number }[] = [];
  parts.forEach((p, pi) => {
    if (p.outline) return;
    p.n.forEach((n, k) => cand.push({ n, s: p.s[k], part: pi, pen: sharePenalty(p.w?.[k]) }));
  });
  if (!cand.length) parts.forEach((p, pi) => p.n.forEach((n, k) => cand.push({ n, s: p.s[k], part: pi, pen: 0 })));
  const memo = new Map<number, [number, number]>();
  return (nr: number, ng: number, nb: number, sr: number, sg: number, sb: number, withShiny: boolean): [number, number] => {
    const key = withShiny
      ? (((nr >> 2) << 12) | ((ng >> 2) << 6) | (nb >> 2)) * 262144 + (((sr >> 2) << 12) | ((sg >> 2) << 6) | (sb >> 2))
      : -((((nr >> 2) << 12) | ((ng >> 2) << 6) | (nb >> 2)) + 1);
    let m = memo.get(key);
    if (m) return m;
    const n = rgbToOklab(nr, ng, nb) as Lab;
    const s = withShiny ? (rgbToOklab(sr, sg, sb) as Lab) : null;
    let best = Infinity, bp = 0;
    for (const c of cand) {
      const d = (s ? MIX(labDist(n, c.n, 0.5), labDist(s, c.s, 0.5)) : labDist(n, c.n, 0.5)) + c.pen;
      if (d < best) { best = d; bp = c.part; }
    }
    m = [bp, best];
    if (memo.size < 200_000) memo.set(key, m);
    return m;
  };
}

/** A part's reference colour [l, c, h] from OKLab samples (mean lightness and chroma, the mean's hue). */
export function refOf(labs: Lab[] | Float32Array, count?: number): [number, number, number] {
  let L = 0, A = 0, B = 0, C = 0, n = 0;
  if (labs instanceof Float32Array) {
    const m = count ?? labs.length / 3;
    for (let i = 0; i < m; i++) {
      const l = labs[i * 3], a = labs[i * 3 + 1], b = labs[i * 3 + 2];
      L += l; A += a; B += b; C += Math.hypot(a, b); n++;
    }
  } else for (const [l, a, b] of labs) { L += l; A += a; B += b; C += Math.hypot(a, b); n++; }
  if (!n) return [0.5, 0, 0];
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [+(L / n).toFixed(4), +(C / n).toFixed(4), +h.toFixed(1)];
}

/** Collects OKLab samples per part, normal and shiny, into reference colours. */
export class RefAccumulator {
  private n: number[][];
  private s: number[][];
  constructor(parts: number) {
    this.n = Array.from({ length: parts }, () => []);
    this.s = Array.from({ length: parts }, () => []);
  }
  add(part: number, nr: number, ng: number, nb: number, sr: number, sg: number, sb: number) {
    if (part < 0 || part >= this.n.length) return;
    this.n[part].push(...rgbToOklab(nr, ng, nb));
    this.s[part].push(...rgbToOklab(sr, sg, sb));
  }
  refs(): HdRef[] {
    return this.n.map((n, i) => [...refOf(Float32Array.from(n)), ...refOf(Float32Array.from(this.s[i]))] as HdRef);
  }
}
