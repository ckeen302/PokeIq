"use client";

/* eslint-disable @next/next/no-img-element -- a tiny pixel-art picture scaled with crisp pixels */
import { useEffect, useRef, useState } from "react";
import { loadSpecies, type Species } from "@/lib/shiny-maker/data";
import { newDesign, type Design } from "@/lib/shiny-maker/design";
import { firstDesign, presetParts, DEFAULT_ID, type Preset, type TypeName } from "@/lib/shiny-maker/presets";
import { partSwatch, renderPixels } from "@/lib/shiny-maker/recolor";
import { hex } from "@/lib/shiny-maker/color";
import { cn } from "@/lib/utils";

/**
 * The Shiny Pokémon Maker's own Charizard, live: the maker's palettes (its
 * first look, the official shiny, its presets and type themes) one after
 * another, each swept in from the top like a scanner, with the parts'
 * colours and the palette's name beside it. Starts from /shiny-maker/hub.png
 * (the same first look) so nothing moves until the data is in; holds still
 * for reduced motion and while off screen.
 */

export const SHINY_STEPS = ["first", "official", "gold", "neon", "water", "pastel", "ghost", "electric", "silver", "psychic"] as const;
export type ShinyStep = (typeof SHINY_STEPS)[number];

function designFor(sp: Species, step: ShinyStep): Design {
  if (step === "first") return firstDesign(sp);
  const d = newDesign(sp.id, sp.parts.length, 0);
  d.parts = presetParts(sp, d, step as Preset | TypeName);
  return d;
}
const dotsOf = (sp: Species, d: Design) => sp.parts.map((p, i) => (p.o ? null : hex(partSwatch(sp, d, i)))).filter((c): c is string => !!c);

export function ShinyCycle({
  w,
  h,
  labels,
  firstDots,
  className,
  figureClassName,
  hudClassName,
  interval = 2600,
  paused,
  hud = true,
}: {
  w: number;
  h: number;
  /** Each step's name, in the page's language. */
  labels: Record<ShinyStep, string>;
  firstDots: string[];
  className?: string;
  figureClassName?: string;
  hudClassName?: string;
  interval?: number;
  paused?: boolean;
  hud?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState(0);
  const [dots, setDots] = useState(firstDots);
  const frames = useRef<{ sp: Species; px: Uint8ClampedArray[]; dots: string[][] } | null>(null);
  const shown = useRef(0);
  const visible = useRef(true);

  // Load the species and draw every palette once.
  useEffect(() => {
    let dead = false;
    loadSpecies(DEFAULT_ID)
      .then((sp) => {
        if (dead) return;
        const designs = SHINY_STEPS.map((s) => designFor(sp, s));
        frames.current = { sp, px: designs.map((d) => renderPixels(sp, d, "yours", 0.6)), dots: designs.map((d) => dotsOf(sp, d)) };
        const ctx = canvas.current?.getContext("2d");
        if (!ctx) return;
        const img = ctx.createImageData(sp.w, sp.h);
        img.data.set(frames.current.px[0]);
        ctx.putImageData(img, 0, 0);
        setReady(true);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);

  // Pause off screen.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Step through the palettes.
  useEffect(() => {
    if (!ready || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!visible.current || document.hidden) return;
      setStep((s) => (s + 1) % SHINY_STEPS.length);
    }, interval);
    return () => window.clearInterval(id);
  }, [ready, paused, interval]);

  // Sweep the new palette in from the top, a bright scan line leading.
  useEffect(() => {
    const f = frames.current;
    const ctx = canvas.current?.getContext("2d");
    if (!ready || !f || !ctx) return;
    const from = f.px[shown.current], to = f.px[step];
    shown.current = step;
    setDots(f.dots[step]);
    const { w: W, h: H } = f.sp;
    const img = ctx.createImageData(W, H);
    const start = performance.now();
    const DUR = 520;
    let raf = 0;
    const draw = (now: number) => {
      const k = Math.min(1, (now - start) / DUR);
      const y = Math.round(k * (H + 3));
      for (let r = 0; r < H; r++) {
        const src = r < y ? to : from;
        const o = r * W * 4;
        img.data.set(src.subarray(o, o + W * 4), o);
        if (k < 1 && (r === y || r === y - 1)) {
          for (let x = 0; x < W; x++) {
            const p = o + x * 4;
            if (img.data[p + 3]) {
              img.data[p] = 255;
              img.data[p + 1] = 255;
              img.data[p + 2] = 255;
            }
          }
        }
      }
      ctx.putImageData(img, 0, 0);
      if (k < 1) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [step, ready]);

  const label = labels[SHINY_STEPS[step]];
  return (
    <div ref={box} className={cn("relative", className)}>
      <div className={cn("relative", figureClassName)} style={{ aspectRatio: `${w} / ${h}` }}>
        <img src="/shiny-maker/hub.png" alt="" width={w} height={h} className={cn("th-px absolute inset-0 h-full w-full", ready && "invisible")} />
        <canvas ref={canvas} width={w} height={h} className={cn("th-px absolute inset-0 h-full w-full", !ready && "invisible")} aria-hidden />
      </div>
      {hud && (
        <div className={cn("flex items-center gap-2", hudClassName)} aria-hidden>
          <span className="flex gap-1">
            {dots.map((c, i) => (
              <span
                key={i}
                className="inline-block h-3 w-3 rounded-full transition-colors duration-300"
                style={{ background: `radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.3), transparent 55%), ${c}`, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.16), 0 1px 2px rgb(0 0 0 / 0.5)" }}
              />
            ))}
          </span>
          <span key={label} className="th-enter-up font-pixel text-[10px] uppercase leading-none tracking-[0.12em] text-white/85">{label}</span>
        </div>
      )}
    </div>
  );
}
