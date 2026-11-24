/**
 * Downloads: PNG at the sprite's own size or scaled up crisply (whole-number nearest-neighbour), with or without
 * the background; animated GIFs encoded in a Worker.
 */
import type { Species } from "./data";
import type { Design } from "./design";
import { frameColours } from "./frames";
import type { GifFrames } from "./gif";
import { renderPixels } from "./recolor";
import { TYPE_GLOW } from "./presets";

/** Paints the stage's background (plain or type glow) behind a figure. */
function paintBg(ctx: CanvasRenderingContext2D, W: number, H: number, d: Design, type: string) {
  ctx.fillStyle = "#0e0c1d";
  ctx.fillRect(0, 0, W, H);
  if (d.bg === "glow") {
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.55);
    const hsl = TYPE_GLOW[type] ?? TYPE_GLOW.normal;
    g.addColorStop(0, `hsl(${hsl} / 0.32)`);
    g.addColorStop(0.55, `hsl(${hsl} / 0.1)`);
    g.addColorStop(1, "hsl(0 0% 0% / 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

/** A canvas of the figure at `scale`, padded with the background when the design has one. */
export function pixelCanvas(sp: Species, d: Design, scale: number, t = 0.6): HTMLCanvasElement {
  const src = document.createElement("canvas");
  src.width = sp.w;
  src.height = sp.h;
  const sctx = src.getContext("2d")!;
  const img = sctx.createImageData(sp.w, sp.h);
  renderPixels(sp, d, "yours", t, img.data);
  sctx.putImageData(img, 0, 0);
  const withBg = d.bg !== "none";
  const pad = withBg ? Math.round(Math.max(sp.w, sp.h) * 0.18) : 0;
  const out = document.createElement("canvas");
  out.width = (sp.w + pad * 2) * scale;
  out.height = (sp.h + pad * 2) * scale;
  const ctx = out.getContext("2d")!;
  if (withBg) paintBg(ctx, out.width, out.height, d, sp.types[0]);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, pad * scale, pad * scale, sp.w * scale, sp.h * scale);
  return out;
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** "pokeiq-shiny-charizard.png", or the design's name ("pokeiq-midnight-zard.png"): named like the site's other downloads. */
export const fileName = (sp: Species, d: Design, ext: string) =>
  `pokeiq-${(d.name || `shiny-${sp.name}`).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shiny"}.${ext}`;

export function canvasBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
}

/** The GIF's frames: the animated sprite's (when given), or a shimmer loop for holo and galaxy. Scaled 3×. */
export function gifFrames(sp: Species, d: Design, frames: GifFrames | null): { width: number; height: number; frames: { rgba: Uint8ClampedArray; delay: number }[] } {
  const S = 3;
  const scaleUp = (src: Uint8ClampedArray, w: number, h: number) => {
    const out = new Uint8ClampedArray(w * S * h * S * 4);
    for (let y = 0; y < h * S; y++)
      for (let x = 0; x < w * S; x++) {
        const i = (((y / S) | 0) * w + ((x / S) | 0)) * 4, o = (y * w * S + x) * 4;
        out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = src[i + 3];
      }
    return out;
  };
  if (frames) {
    const paint = frameColours(sp, d, "yours");
    let t = 0;
    return {
      width: frames.width * S,
      height: frames.height * S,
      frames: frames.frames.map((f) => {
        const px = new Uint8ClampedArray(frames.width * frames.height * 4);
        paint.paint(f.pixels, px, frames.width, frames.height, t);
        t += f.delay / 1000;
        return { rgba: scaleUp(px, frames.width, frames.height), delay: f.delay };
      }),
    };
  }
  // One full turn of the holo bands, so the loop is seamless.
  const n = 36, span = 360 / 70;
  return {
    width: sp.w * S,
    height: sp.h * S,
    frames: Array.from({ length: n }, (_, i) => ({ rgba: scaleUp(renderPixels(sp, d, "yours", 0.6 + (i / n) * span), sp.w, sp.h), delay: Math.round((span / n) * 1000) })),
  };
}

export function encodeInWorker(job: ReturnType<typeof gifFrames>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./gif.worker.ts", import.meta.url));
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.ok) resolve(new Blob([e.data.bytes], { type: "image/gif" }));
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => { w.terminate(); reject(e); };
    w.postMessage(job, job.frames.map((f) => f.rgba.buffer));
  });
}
