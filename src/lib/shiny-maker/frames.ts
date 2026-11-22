/**
 * Animated B/W sprites in the maker: each frame's colours are mapped to the static sprite's palette slots (an
 * exact colour match first, else the nearest slot), so a design recolours every frame the same way.
 */
import { lchToRgb } from "./color";
import type { Species } from "./data";
import type { Design } from "./design";
import { decodeGif, type GifFrames } from "./gif";
import { finishPixel, perPixel, slotColours, type View } from "./recolor";

export const animatedUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${id}.gif`;

export function toSlotFrames(sp: Species, bytes: Uint8Array): GifFrames {
  const gif = decodeGif(bytes);
  const exact = new Map<number, number>();
  // The slot with the most pixels wins when two share a normal colour.
  sp.slots.forEach((s, i) => {
    const c = (s.normal[0] << 16) | (s.normal[1] << 8) | s.normal[2];
    const cur = exact.get(c);
    if (cur === undefined || sp.slots[cur].count < s.count) exact.set(c, i);
  });
  const near = (c: number) => {
    let best = 0, bd = Infinity;
    sp.slots.forEach((s, i) => {
      const d = (s.normal[0] - ((c >> 16) & 255)) ** 2 + (s.normal[1] - ((c >> 8) & 255)) ** 2 + (s.normal[2] - (c & 255)) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    exact.set(c, best);
    return best;
  };
  const frames = gif.frames.map((f) => {
    const pixels = new Int16Array(gif.width * gif.height).fill(-1);
    for (let i = 0, j = 0; j < pixels.length; i += 4, j++) {
      if (f.rgba[i + 3] < 128) continue;
      const c = (f.rgba[i] << 16) | (f.rgba[i + 1] << 8) | f.rgba[i + 2];
      pixels[j] = exact.get(c) ?? near(c);
    }
    return { pixels, delay: f.delay };
  });
  return { width: gif.width, height: gif.height, frames, total: frames.reduce((a, f) => a + f.delay, 0) || 1 };
}

const cache = new Map<number, Promise<GifFrames | null>>();
/** The species' animated sprite as slot frames, or null when there is none (or it can't be fetched). */
export function loadFrames(sp: Species): Promise<GifFrames | null> {
  if (!sp.anim) return Promise.resolve(null);
  let p = cache.get(sp.id);
  if (!p) {
    p = fetch(animatedUrl(sp.id))
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? toSlotFrames(sp, new Uint8Array(b)) : null))
      .catch(() => null);
    cache.set(sp.id, p);
  }
  return p;
}

/** Paints slot frames in a design's colours. */
export function frameColours(sp: Species, d: Design, view: View) {
  const { lch, rgb, finished } = slotColours(sp, d, view);
  const pp = view === "yours" && perPixel(d.finish);
  return {
    paint(pixels: Int16Array, out: Uint8ClampedArray, W: number, H: number, t: number) {
      for (let y = 0, o = 0; y < H; y++)
        for (let x = 0; x < W; x++, o += 4) {
          const v = pixels[y * W + x];
          if (v < 0) { out[o + 3] = 0; continue; }
          let c = rgb[v];
          if (pp && finished[v]) {
            const f = finishPixel(lch[v], d.finish, x, y, x / W, y / H, t);
            c = lchToRgb(f.l, f.c, f.h);
          }
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
        }
    },
  };
}
