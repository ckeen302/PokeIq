"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Species } from "@/lib/shiny-maker/data";
import type { Design } from "@/lib/shiny-maker/design";
import { perPixel, renderPixels, type View } from "@/lib/shiny-maker/recolor";
import type { GifFrames } from "@/lib/shiny-maker/gif";
import { frameColours } from "@/lib/shiny-maker/frames";

export interface FigureHandle {
  /** The part under a point in client coordinates (−1 none). */
  partAt(clientX: number, clientY: number): number;
}

/**
 * The Pokémon in Pixel style: its pixels drawn once per change with putImageData, shown at a whole-number scale
 * with crisp pixels. Holo and galaxy shimmer (unless motion is reduced); an animated sprite plays its frames.
 */
export const PixelFigure = forwardRef<FigureHandle, {
  sp: Species;
  design: Design;
  view: View;
  /** Play the animated sprite (the Animated style). */
  animate: boolean;
  scale: number;
  hover: number;
  selected: number;
  motion: boolean;
  frames: GifFrames | null;
  label: string;
}>(function PixelFigure({ sp, design, view, animate, scale, hover, selected, motion, frames, label }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const outline = useRef<HTMLCanvasElement>(null);
  const anim = !!frames && animate && motion;
  const W = anim ? frames!.width : sp.w, H = anim ? frames!.height : sp.h;

  useImperativeHandle(ref, () => ({
    partAt(cx, cy) {
      const el = canvas.current;
      if (!el || anim) return partAtStill(sp, el, cx, cy);
      return partAtStill(sp, el, cx, cy);
    },
  }), [sp, anim]);

  // Draw (and keep drawing while something moves).
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    el.width = W;
    el.height = H;
    const img = ctx.createImageData(W, H);
    const shimmer = motion && view === "yours" && perPixel(design.finish) && design.finish !== "gradient";
    if (anim && frames) {
      const colours = frameColours(sp, design, view);
      let raf = 0, start = performance.now();
      const draw = (now: number) => {
        const t = (now - start) / 1000;
        let ms = ((now - start) % frames.total);
        let fi = 0;
        while (fi < frames.frames.length - 1 && ms >= frames.frames[fi].delay) { ms -= frames.frames[fi].delay; fi++; }
        const fr = frames.frames[fi];
        colours.paint(fr.pixels, img.data, W, H, shimmer ? t : 0);
        ctx.putImageData(img, 0, 0);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
      start = performance.now();
      return () => cancelAnimationFrame(raf);
    }
    if (!shimmer) {
      renderPixels(sp, design, view, 0.6, img.data);
      ctx.putImageData(img, 0, 0);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    let last = 0;
    const draw = (now: number) => {
      // ~30 fps is plenty for a slow shimmer.
      if (now - last > 32) {
        renderPixels(sp, design, view, 0.6 + (now - t0) / 1000, img.data);
        ctx.putImageData(img, 0, 0);
        last = now;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sp, design, view, motion, anim, frames, W, H]);

  // The hovered (or selected) part's outline, drawn at screen resolution.
  useEffect(() => {
    const el = outline.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = scale * dpr;
    el.width = sp.w * s;
    el.height = sp.h * s;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    const part = hover >= 0 ? hover : -1;
    if (part < 0 || anim || view !== "yours") return;
    const inPart = (x: number, y: number) => x >= 0 && y >= 0 && x < sp.w && y < sp.h && sp.index[y * sp.w + x] >= 0 && sp.partOf[sp.index[y * sp.w + x]] === part;
    ctx.beginPath();
    for (let y = 0; y < sp.h; y++)
      for (let x = 0; x < sp.w; x++) {
        if (!inPart(x, y)) continue;
        if (!inPart(x, y - 1)) { ctx.moveTo(x * s, y * s); ctx.lineTo((x + 1) * s, y * s); }
        if (!inPart(x, y + 1)) { ctx.moveTo(x * s, (y + 1) * s); ctx.lineTo((x + 1) * s, (y + 1) * s); }
        if (!inPart(x - 1, y)) { ctx.moveTo(x * s, y * s); ctx.lineTo(x * s, (y + 1) * s); }
        if (!inPart(x + 1, y)) { ctx.moveTo((x + 1) * s, y * s); ctx.lineTo((x + 1) * s, (y + 1) * s); }
      }
    ctx.lineCap = "square";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 4 * dpr;
    ctx.stroke();
    ctx.strokeStyle = part === selected ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.75 * dpr;
    ctx.stroke();
  }, [sp, hover, selected, scale, anim, view]);

  return (
    <div className="relative" style={{ width: W * scale, height: H * scale }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        className="sm-pixels block h-full w-full"
        style={{ width: W * scale, height: H * scale }}
        data-testid="sm-canvas"
      />
      {!anim && <canvas ref={outline} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />}
    </div>
  );
});

function partAtStill(sp: Species, el: HTMLCanvasElement | null, cx: number, cy: number): number {
  if (!el) return -1;
  const r = el.getBoundingClientRect();
  const x = Math.floor(((cx - r.left) / r.width) * sp.w), y = Math.floor(((cy - r.top) / r.height) * sp.h);
  // A little forgiveness: the nearest coloured pixel within one sprite pixel.
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= sp.w || yy >= sp.h) continue;
    const v = sp.index[yy * sp.w + xx];
    if (v >= 0) return sp.partOf[v];
  }
  return -1;
}
