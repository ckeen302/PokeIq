"use client";

/* eslint-disable @next/next/no-img-element -- MOCK: pre-recoloured sprites */
/* MOCK ONLY: shared pieces of the Shiny Maker mock (data, stage, colour controls). Nothing is wired up. */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { hexOf, maxChroma, oklch } from "./oklch";
import data from "../../../../public/mock/shiny-studio/data.json";

export const A = "/mock/shiny-studio";
const RAMPS = data.ramps as Record<string, { normal: string[]; yours: string[]; official: string[] }>;

export type PartId = "body" | "belly" | "wings" | "flame" | "eyes";

/** The selected part (Wings) in OKLCH: ember gold. */
export const SEL = { h: 80, c: 0.15, l: 0.76 };
export const SEL_HEX = hexOf(SEL.l, SEL.c, SEL.h);

export const PARTS: { id: PartId; name: string; color: string }[] = [
  { id: "body", name: "Body", color: RAMPS.body.yours[0] },
  { id: "belly", name: "Belly", color: RAMPS.belly.yours[0] },
  { id: "wings", name: "Wings", color: SEL_HEX },
  { id: "flame", name: "Flame", color: RAMPS.flame.yours[1] },
  { id: "eyes", name: "Eyes", color: RAMPS.eyes.yours[0] },
];

/** A short, curated set for any part: picked to look good as a shiny. */
export const CURATED: string[] = [
  SEL_HEX,
  hexOf(0.72, 0.15, 25),
  hexOf(0.78, 0.12, 350),
  hexOf(0.8, 0.13, 155),
  hexOf(0.74, 0.12, 230),
  hexOf(0.66, 0.15, 295),
  hexOf(0.88, 0.012, 260),
  hexOf(0.36, 0.03, 285),
];

export type Look = "normal" | "official" | "yours";
export const SPRITE: Record<Look, string> = {
  normal: `${A}/px-normal.png`,
  official: `${A}/px-official.png`,
  yours: `${A}/px-yours.png`,
};
export const AVATAR = `${A}/hd-normal.png`;

/** The Pokémon on its stage: crisp pixels, a soft glow of its type behind it, a faint floor shadow. */
export function Hero({ scale, look = "yours", className }: { scale: number; look?: Look; className?: string }) {
  const size = 96 * scale;
  return (
    <div className={cn("relative flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <div className="maker-glow pointer-events-none absolute" style={{ inset: -size * 0.28 }} aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-black/45 blur-xl"
        style={{ width: size * 0.62, height: size * 0.07, bottom: size * 0.07 }}
        aria-hidden
      />
      <img
        src={SPRITE[look]}
        alt={look === "yours" ? "Your shiny Charizard" : look === "official" ? "Official shiny Charizard" : "Normal Charizard"}
        width={size}
        height={size}
        className="relative select-none [image-rendering:pixelated]"
        draggable={false}
      />
    </div>
  );
}

/** Small segmented control (Normal / Official / Yours, Pixel / HD). */
export function Segmented({ items, value, className, size = "md" }: { items: string[]; value: string; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("inline-flex rounded-full border border-foreground/[0.08] bg-foreground/[0.04] p-1 backdrop-blur", className)} role="radiogroup">
      {items.map((it) => (
        <button
          key={it}
          type="button"
          role="radio"
          aria-checked={it === value}
          className={cn(
            "rounded-full font-medium transition-colors",
            size === "md" ? "h-8 px-4 text-[13px]" : "h-7 px-3 text-xs",
            it === value ? "bg-foreground/[0.1] text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {it}
        </button>
      ))}
    </div>
  );
}

/** A part's colour as a dot. */
export function Dot({ color, size = 18, className, ring }: { color: string; size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full", ring && "outline outline-2 outline-offset-[3px] outline-white/85", className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.28), transparent 55%), ${color}`,
        boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.5)",
      }}
      aria-hidden
    />
  );
}

/** Lightness (up) × colourfulness (across) for one hue, always inside what a screen can show. */
export function TonePlane({ width, height, h = SEL.h, l = SEL.l, c = SEL.c, className, radius = 12 }: { width: number; height: number; h?: number; l?: number; c?: number; className?: string; radius?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = 2, W = width * dpr, H = height * dpr;
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const L = 0.98 - (y / (H - 1)) * 0.9;
      const mc = maxChroma(L, h);
      for (let x = 0; x < W; x++) {
        const { rgb } = oklch(L, (x / (W - 1)) * mc, h);
        const o = (y * W + x) * 4;
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [width, height, h]);
  const mx = c / maxChroma(l, h);
  const my = (0.98 - l) / 0.9;
  return (
    <div className={cn("relative", className)} style={{ width, height }}>
      <canvas ref={ref} className="block h-full w-full" style={{ borderRadius: radius, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.08)" }} aria-hidden />
      <Knob color={hexOf(l, c, h)} style={{ left: `${mx * 100}%`, top: `${my * 100}%` }} />
    </div>
  );
}

export function Knob({ color, style, size = 20 }: { color: string; style?: React.CSSProperties; size?: number }) {
  return (
    <span
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white"
      style={{ width: size, height: size, background: color, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.25), 0 2px 8px rgb(0 0 0 / 0.45)", ...style }}
      aria-hidden
    />
  );
}

const HUES = Array.from({ length: 25 }, (_, i) => hexOf(0.74, 0.14, i * 15));

/** A thin hue rail. */
export function HueRail({ h = SEL.h, className }: { h?: number; className?: string }) {
  return (
    <div className={cn("relative h-3 rounded-full", className)} style={{ background: `linear-gradient(90deg, ${HUES.join(",")})`, boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.08)" }} role="slider" aria-label="Hue" aria-valuenow={h} aria-valuemin={0} aria-valuemax={360}>
      <Knob color={hexOf(0.74, 0.14, h)} style={{ left: `${(h / 360) * 100}%`, top: "50%" }} size={18} />
    </div>
  );
}

/** A hue ring with the tone plane inside it (compact, for a popover). */
export function HueRing({ size = 200, ring = 14, h = SEL.h }: { size?: number; ring?: number; h?: number }) {
  const inner = Math.round((size - ring * 2 - 20) / Math.SQRT2);
  const a = ((h - 90) * Math.PI) / 180;
  const r = size / 2 - ring / 2;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 90deg, ${HUES.join(",")})`,
          WebkitMask: `radial-gradient(circle, transparent ${size / 2 - ring - 0.5}px, #000 ${size / 2 - ring}px)`,
          mask: `radial-gradient(circle, transparent ${size / 2 - ring - 0.5}px, #000 ${size / 2 - ring}px)`,
        }}
        aria-hidden
      />
      <Knob color={hexOf(0.74, 0.14, h)} style={{ left: size / 2 + r * Math.cos(a), top: size / 2 + r * Math.sin(a) }} size={22} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <TonePlane width={inner} height={inner} radius={10} />
      </div>
    </div>
  );
}

/** The curated swatches, the current one ringed. */
export function Swatches({ size = 26, className, current = SEL_HEX, count = 8 }: { size?: number; className?: string; current?: string; count?: number }) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      {CURATED.slice(0, count).map((c) => (
        <button key={c} type="button" aria-label={`Use ${c}`} className="rounded-full">
          <Dot color={c} size={size} ring={c === current} />
        </button>
      ))}
    </div>
  );
}

export const MAKER_CSS = `
.maker-glow {
  background:
    radial-gradient(closest-side, hsl(24 95% 58% / 0.26), hsl(24 95% 58% / 0.09) 55%, transparent 100%),
    radial-gradient(closest-side at 55% 35%, hsl(190 90% 60% / 0.08), transparent 70%);
  filter: blur(8px);
}
.maker-stage {
  background:
    radial-gradient(70% 60% at 50% 48%, hsl(250 40% 14% / 0.65), transparent 75%),
    linear-gradient(180deg, hsl(248 34% 9% / 0.92), hsl(248 36% 6% / 0.96));
  box-shadow: inset 0 1px 0 hsl(0 0% 100% / 0.04), 0 30px 80px -40px rgb(0 0 0 / 0.8);
}
.maker-dock {
  background: hsl(248 30% 12% / 0.72);
  backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(0 0% 100% / 0.07), 0 20px 50px -12px rgb(0 0 0 / 0.75);
}
.maker-pop {
  background: hsl(248 30% 11% / 0.94);
  backdrop-filter: blur(18px);
  box-shadow: inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 0 0 1px hsl(0 0% 100% / 0.08), 0 30px 60px -16px rgb(0 0 0 / 0.85);
}
`;
