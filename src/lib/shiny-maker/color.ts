/**
 * OKLab / OKLCH for the Shiny Pokémon Maker (Björn Ottosson's OKLab, sRGB D65).
 * Out-of-gamut colours are brought inside by lowering chroma at the same lightness and hue
 * (the CSS Color 4 approach), never by clipping RGB channels, so a hue never drifts.
 * Pure and dependency-free: the browser, the server's preview cards and the build script share it.
 */

export type RGB = [number, number, number];
/** Lightness 0..1, chroma 0..~0.37, hue in degrees. */
export interface LCH {
  l: number;
  c: number;
  h: number;
}

const toLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB (0..255) to linear lookup: the recolour loops call it a lot. */
const LIN = new Float64Array(256).map((_, i) => toLin(i));

export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = LIN[r & 255], lg = LIN[g & 255], lb = LIN[b & 255];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to linear sRGB (may be outside 0..1). */
export function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const EPS = 0.0001;
const inside = (v: [number, number, number]) => v[0] >= -EPS && v[0] <= 1 + EPS && v[1] >= -EPS && v[1] <= 1 + EPS && v[2] >= -EPS && v[2] <= 1 + EPS;

export function rgbToLch(r: number, g: number, b: number): LCH {
  const [l, a, bb] = rgbToOklab(r, g, b);
  const c = Math.hypot(a, bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h };
}

export function inGamut(l: number, c: number, h: number): boolean {
  const r = (h * Math.PI) / 180;
  return inside(oklabToLinear(l, c * Math.cos(r), c * Math.sin(r)));
}

/** The most chroma sRGB can show at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  if (l <= 0 || l >= 1) return 0;
  const r = (h * Math.PI) / 180, ca = Math.cos(r), sa = Math.sin(r);
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inside(oklabToLinear(l, mid * ca, mid * sa))) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** An OKLCH colour as sRGB 0..255, chroma reduced (same L and h) until it fits. */
export function lchToRgb(l: number, c: number, h: number): RGB {
  const L = Math.min(1, Math.max(0, l));
  const r = (h * Math.PI) / 180, ca = Math.cos(r), sa = Math.sin(r);
  let C = Math.max(0, c);
  let lin = oklabToLinear(L, C * ca, C * sa);
  if (!inside(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (inside(oklabToLinear(L, mid * ca, mid * sa))) lo = mid;
      else hi = mid;
    }
    C = lo;
    lin = oklabToLinear(L, C * ca, C * sa);
  }
  return [enc(lin[0]), enc(lin[1]), enc(lin[2])];
}

const enc = (v: number) => Math.round(Math.min(1, Math.max(0, fromLin(Math.min(1, Math.max(0, v))))) * 255);

export const hex = (rgb: RGB) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
export function parseHex(s: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const lchHex = (c: LCH) => hex(lchToRgb(c.l, c.c, c.h));

/** Signed shortest difference b − a in degrees, −180..180. */
export function hueDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
export const wrapHue = (h: number) => ((h % 360) + 360) % 360;

/** OKLab distance with lightness weighted (ramps of one part share hue, not lightness). */
export function labDist(p: [number, number, number], q: [number, number, number], wl = 1): number {
  return Math.hypot((p[0] - q[0]) * wl, p[1] - q[1], p[2] - q[2]);
}
