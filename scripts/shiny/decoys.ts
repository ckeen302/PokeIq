import sharp from "sharp";

/**
 * Fake-shiny generation for the "Which is the real shiny?" quiz.
 *
 * Each decoy is the real shiny with its colours moved in CIELAB: the (a, b)
 * plane is rotated (a hue shift) and nudged by a tint (so grey or white
 * Pokémon still change), and lightness is shifted slightly. One strength
 * parameter is bisected until the mean colour difference (ΔE76 over the
 * sprite's opaque pixels) reaches the tier's target, so every Pokémon gets
 * decoys that are really near / medium / far and never invisible.
 */

export const OUT_SIZE = 384; // 96px sprites scaled 4x, nearest neighbour
export type Tier = "near" | "medium" | "far";

/** Mean ΔE targets per tier. `near` is subtle but clearly visible; MIN_DELTA_E is the hard floor. */
export const TARGETS: Record<Tier, number> = { near: 9, medium: 18, far: 32 };
export const MIN_DELTA_E = 7;
/** Decoys must also differ from each other by at least this much. */
export const MIN_PAIR_DELTA_E = 5;

export interface Raw { data: Uint8Array; width: number; height: number }

const srgbToLin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linToSrgb = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const finv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const WHITE = [0.95047, 1, 1.08883];

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [srgbToLin(r), srgbToLin(g), srgbToLin(b)];
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb;
  const [fx, fy, fz] = [f(x / WHITE[0]), f(y / WHITE[1]), f(z / WHITE[2])];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const [x, y, z] = [finv(fy + a / 500) * WHITE[0], finv(fy) * WHITE[1], finv(fy - b / 200) * WHITE[2]];
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linToSrgb(lr), linToSrgb(lg), linToSrgb(lb)];
}

export interface Shift { angle: number; tint: number; tintDir: number; dL: number }

/** Shift for strength `s` in [0, 1]: up to 150° of hue, 45 of tint, 14 of lightness. */
export function shiftFor(s: number, sign: 1 | -1, tintDir: number): Shift {
  return { angle: sign * s * 150 * (Math.PI / 180), tint: s * 45, tintDir, dL: sign * s * 14 };
}

export function applyShift(src: Raw, shift: Shift): Raw {
  const out = new Uint8Array(src.data.length);
  const cos = Math.cos(shift.angle), sin = Math.sin(shift.angle);
  const ta = Math.cos(shift.tintDir) * shift.tint, tb = Math.sin(shift.tintDir) * shift.tint;
  for (let i = 0; i < src.data.length; i += 4) {
    const alpha = src.data[i + 3];
    out[i + 3] = alpha;
    if (alpha === 0) continue;
    const [L, a, b] = rgbToLab(src.data[i], src.data[i + 1], src.data[i + 2]);
    // The tint fades out for very dark pixels (outlines, eyes) so they stay dark.
    const w = Math.min(1, L / 35);
    const [r, g, bl] = labToRgb(Math.min(100, Math.max(0, L + shift.dL * w)), a * cos - b * sin + ta * w, a * sin + b * cos + tb * w);
    out[i] = r; out[i + 1] = g; out[i + 2] = bl;
  }
  return { data: out, width: src.width, height: src.height };
}

/** Mean ΔE76 over pixels that are opaque in either image (the quantity the tiers are tuned on). */
export function meanDeltaE(x: Raw, y: Raw): number {
  let sum = 0, n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    if (x.data[i + 3] < 128 && y.data[i + 3] < 128) continue;
    const p = rgbToLab(x.data[i], x.data[i + 1], x.data[i + 2]);
    const q = rgbToLab(y.data[i], y.data[i + 1], y.data[i + 2]);
    sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    n++;
  }
  return n ? sum / n : 0;
}

/** Deterministic PRNG (mulberry32) for the sign / tint direction per Pokémon. */
export function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Decoy { tier: Tier; raw: Raw; deltaE: number }

/** Bisect strength so the mean ΔE reaches `target`; null if even full strength can't reach `floor`. */
function fit(src: Raw, target: number, sign: 1 | -1, tintDir: number, floor: number): { raw: Raw; deltaE: number } | null {
  let lo = 0, hi = 1;
  let best = applyShift(src, shiftFor(hi, sign, tintDir));
  if (meanDeltaE(src, best) < floor) return null;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const cand = applyShift(src, shiftFor(mid, sign, tintDir));
    if (meanDeltaE(src, cand) < target) lo = mid;
    else { hi = mid; best = cand; }
  }
  return { raw: best, deltaE: meanDeltaE(src, best) };
}

/** Three decoys (near, medium, far) for one shiny, or throws if the minimum difference can't be met. */
export function makeDecoys(src: Raw, seed: number): Decoy[] {
  const rnd = seeded(seed);
  const baseDir = rnd() * Math.PI * 2;
  const tiers: Tier[] = ["near", "medium", "far"];
  for (let attempt = 0; attempt < 12; attempt++) {
    const out: Decoy[] = [];
    for (const [i, tier] of tiers.entries()) {
      const sign: 1 | -1 = rnd() < 0.5 ? 1 : -1;
      // Spread tint directions so the three decoys are not just stronger copies of one another.
      const dir = baseDir + (i * 2 * Math.PI) / 3 + attempt * 0.7;
      const d = fit(src, TARGETS[tier], sign, dir, MIN_DELTA_E);
      if (!d) break;
      out.push({ tier, ...d });
    }
    if (out.length < 3) continue;
    let ok = true;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (meanDeltaE(out[i].raw, out[j].raw) < MIN_PAIR_DELTA_E) ok = false;
    if (ok) return out;
  }
  throw new Error("could not build decoys above the minimum difference");
}

export async function loadRaw(png: Buffer): Promise<Raw> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/** Every option (real or fake) goes through exactly this: same size, same format, no metadata. */
export function encodeOption(raw: Raw): Promise<Buffer> {
  return sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize(OUT_SIZE, OUT_SIZE, { kernel: "nearest", fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ lossless: true, effort: 4 })
    .toBuffer();
}
