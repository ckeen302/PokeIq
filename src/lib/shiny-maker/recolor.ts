/**
 * Recolouring: a design's colours for each palette slot and each pixel of a species.
 *
 * A part keeps its shading: every shade is placed relative to the part's reference colour (the pixel-weighted
 * average of its shades) by its lightness offset (times the contrast k), its chroma ratio and its own small hue
 * offset, then moved to the chosen colour. Once the hue moves away from the source, highlights lean a little warmer
 * and shadows a little cooler, as pixel artists shade. Everything is gamut-mapped by lowering chroma.
 * The same maths runs in the HD shader (hd-shader.ts).
 */
import { hueDiff, lchToRgb, wrapHue, type LCH, type RGB } from "./color";
import type { Design, Finish, PartColour } from "./design";
import type { Species } from "./data";

export type Ref = LCH;

/** Each part's reference colour from its normal (src 0) or shiny (src 1) shades. */
export function partRefs(sp: Species, src: 0 | 1): Ref[] {
  return sp.parts.map((p) => {
    let L = 0, A = 0, B = 0, C = 0, n = 0;
    for (const s of p.s) {
      const slot = sp.slots[s];
      if (!slot) continue;
      const c = src ? slot.sl : slot.nl;
      const w = Math.max(1, slot.count);
      const r = (c.h * Math.PI) / 180;
      L += c.l * w; C += c.c * w; A += Math.cos(r) * c.c * w; B += Math.sin(r) * c.c * w; n += w;
    }
    if (!n) return { l: 0.5, c: 0, h: 0 };
    return { l: L / n, c: C / n, h: wrapHue((Math.atan2(B, A) * 180) / Math.PI) };
  });
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Lightness `l` moved by `x`, easing into the ends so highlights and shadows never flatten into one. */
export function softL(l: number, x: number): number {
  if (x >= 0) {
    const room = 0.985 - l;
    return room <= 0.001 ? l : l + room * (1 - Math.exp(-x / room));
  }
  const room = l - 0.04;
  return room <= 0.001 ? l : l - room * (1 - Math.exp(x / room));
}

const toward = (h: number, target: number, amt: number) => {
  const d = hueDiff(h, target);
  return h + Math.sign(d) * Math.min(Math.abs(d), amt);
};

/** One shade of a part, moved from the part's reference colour to the chosen colour. */
export function transform(src: LCH, ref: Ref, t: PartColour): LCH {
  const d = src.l - ref.l;
  const l = softL(t.l, d * t.k);
  const grey = ref.c < 0.03;
  const ratio = grey ? 1 - Math.min(0.55, Math.abs(d) * 1.1) : Math.min(1.8, Math.max(0.25, src.c / ref.c));
  const c = t.c * ratio;
  const own = smooth(0.02, 0.06, Math.min(src.c, ref.c)) * hueDiff(ref.h, src.h);
  const moved = grey ? 1 : Math.min(1, Math.abs(hueDiff(ref.h, t.h)) / 30);
  let h = t.h + own;
  const warm = 30 * Math.abs(l - t.l) * moved;
  if (warm > 0.01) h = l > t.l ? toward(h, 80, warm) : toward(h, 265, warm);
  return { l, c, h: wrapHue(h) };
}

/** Colour-only finishes (applied per shade). */
export function finishShade(c: LCH, f: Finish): LCH {
  switch (f) {
    case "metallic": {
      const l = Math.min(0.97, Math.max(0.08, 0.52 + (c.l - 0.52) * 1.45 + 0.02));
      return { l, c: c.c * (0.9 - 0.65 * smooth(0.62, 0.95, l)), h: c.h };
    }
    case "pastel":
      return { l: Math.min(0.95, 0.8 + (c.l - 0.62) * 0.45), c: Math.min(c.c * 0.6, 0.1), h: c.h };
    default:
      return c;
  }
}

/** A finish that varies across the figure (gradient, holo, galaxy). */
export const perPixel = (f: Finish) => f === "gradient" || f === "holo" || f === "galaxy";

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** A position-dependent finish for one pixel: u, v in 0..1 across the figure, t in seconds (0 when still). */
export function finishPixel(c: LCH, f: Finish, x: number, y: number, u: number, v: number, t: number): LCH {
  switch (f) {
    case "gradient":
      return { l: c.l + (0.5 - v) * 0.06, c: c.c * 1.05, h: wrapHue(c.h + (v - 0.5) * 80) };
    case "holo": {
      const phase = (u * 0.8 + v * 1.1) * 360 + t * 70;
      const band = wrapHue(phase);
      const mix = 0.4 + 0.25 * smooth(0.55, 0.9, c.l);
      return { l: Math.min(0.96, c.l + 0.04), c: Math.max(c.c * 0.7, 0.11 * mix + c.c * (1 - mix)), h: wrapHue(c.h + hueDiff(c.h, band) * mix) };
    }
    case "galaxy": {
      const r = hash(x, y);
      if (r < 0.045) {
        const tw = t ? 0.5 + 0.5 * Math.sin(t * 2.4 + r * 400) : 1;
        if (tw > 0.35) return { l: 0.86 + 0.1 * tw, c: 0.03, h: 250 };
      }
      const swirl = Math.sin(u * 6.5 + v * 4 + Math.sin(v * 9) * 0.8);
      return { l: 0.16 + c.l * 0.42 + swirl * 0.03, c: 0.07 + 0.06 * (0.5 + 0.5 * swirl), h: wrapHue(285 + swirl * 35 + (c.h - 285) * 0.15) };
    }
    default:
      return c;
  }
}

export type View = "normal" | "official" | "yours";

/** Each slot's colour (before any per-pixel finish) as LCH, plus whether the slot takes the finish. */
export function slotColours(sp: Species, d: Design, view: View = "yours"): { lch: LCH[]; rgb: RGB[]; finished: boolean[] } {
  const refs = [partRefs(sp, 0), partRefs(sp, 1)];
  const lch: LCH[] = [], rgb: RGB[] = [], finished: boolean[] = [];
  sp.slots.forEach((slot, i) => {
    const pi = sp.partOf[i];
    const part = sp.parts[pi];
    if (view !== "yours") {
      const shiny = view === "official";
      lch.push(shiny ? slot.sl : slot.nl);
      rgb.push(shiny ? slot.shiny : slot.normal);
      finished.push(false);
      return;
    }
    const own = d.shades[i];
    const st = d.parts[pi] ?? { src: 1, col: null };
    const fin = !part?.o && !own && d.finish !== "flat";
    finished.push(fin);
    if (own) {
      rgb.push(own);
      lch.push({ l: 0, c: 0, h: 0 });
      return;
    }
    const src = st.src ? slot.sl : slot.nl;
    let c: LCH = st.col ? transform(src, refs[st.src][pi], st.col) : src;
    if (fin) c = finishShade(c, d.finish);
    lch.push(c);
    rgb.push(!st.col && !fin ? (st.src ? slot.shiny : slot.normal) : lchToRgb(c.l, c.c, c.h));
  });
  return { lch, rgb, finished };
}

/** The design's colour for a part's swatch (its chosen colour, or its source's reference colour). */
export function partSwatch(sp: Species, d: Design, pi: number): RGB {
  const st = d.parts[pi];
  if (st?.col) return lchToRgb(st.col.l, st.col.c, st.col.h);
  // The slot nearest the reference (a colour that really is in the sprite).
  const ref = partRefs(sp, st?.src ?? 1)[pi];
  let best: RGB = [128, 128, 128], bd = Infinity;
  for (const s of sp.parts[pi].s) {
    const slot = sp.slots[s];
    const c = st?.src ? slot.sl : slot.nl;
    const dd = Math.abs(c.l - ref.l) * 2 - slot.count / 5000;
    if (dd < bd) { bd = dd; best = st?.src ? slot.shiny : slot.normal; }
  }
  return best;
}

/** The figure's pixels (RGBA, sp.w × sp.h) for a view of the design at time t (seconds; holo and galaxy move). */
export function renderPixels(sp: Species, d: Design, view: View = "yours", t = 0, out?: Uint8ClampedArray): Uint8ClampedArray {
  const { w, h, index } = sp;
  const px = out ?? new Uint8ClampedArray(w * h * 4);
  const { lch, rgb, finished } = slotColours(sp, d, view);
  const pp = view === "yours" && perPixel(d.finish);
  for (let y = 0, o = 0; y < h; y++)
    for (let x = 0; x < w; x++, o += 4) {
      const v = index[y * w + x];
      if (v < 0) {
        px[o + 3] = 0;
        continue;
      }
      let c = rgb[v];
      if (pp && finished[v]) {
        const f = finishPixel(lch[v], d.finish, x, y, x / w, y / h, t);
        c = lchToRgb(f.l, f.c, f.h);
      }
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  return px;
}
