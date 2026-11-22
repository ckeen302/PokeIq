"use client";

/* eslint-disable @next/next/no-img-element -- MOCK: pre-recoloured sprites */
/* MOCK ONLY: shared pieces of the Shiny Studio mock (data, wheel, sliders, stage art). */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { oklch, hexOf } from "./oklch";
import data from "../../../../public/mock/shiny-studio/data.json";

export const A = "/mock/shiny-studio";
export const RAMPS = data.ramps as Record<string, { normal: string[]; yours: string[]; official: string[] }>;
export const NOTICE = data.notice;
export const PRESET_SWATCHES = data.presetSwatches as Record<string, string[]>;

export type PartId = "body" | "belly" | "wings" | "flame" | "eyes" | "mouth" | "claws" | "outline";
export const PARTS: { id: PartId; name: string; short: string; locked?: boolean; expert?: boolean }[] = [
  { id: "body", name: "Body", short: "Body" },
  { id: "belly", name: "Belly", short: "Belly" },
  { id: "wings", name: "Wings (membrane)", short: "Wings" },
  { id: "flame", name: "Tail flame", short: "Flame" },
  { id: "eyes", name: "Eyes", short: "Eyes" },
  { id: "mouth", name: "Mouth", short: "Mouth" },
  { id: "claws", name: "Claws & fangs", short: "Claws", locked: true },
  { id: "outline", name: "Outline", short: "Outline", expert: true },
];

/** The selected part's colour (Wings: ember gold). */
export const SEL = { h: 80, c: 0.15, l: 0.76, contrast: 1.3 };
export const SEL_HEX = hexOf(SEL.l, SEL.c, SEL.h);

export const PRESETS: { id: string; label: string; src: string; hint?: string }[] = [
  { id: "normal", label: "Normal", src: `${A}/px-normal.png` },
  { id: "official", label: "Official", src: `${A}/px-official.png` },
  { id: "gold", label: "Gold", src: `${A}/px-preset-gold.png` },
  { id: "silver", label: "Silver", src: `${A}/px-preset-silver.png` },
  { id: "obsidian", label: "Obsidian", src: `${A}/px-preset-obsidian.png` },
  { id: "neon", label: "Neon", src: `${A}/px-preset-neon.png` },
  { id: "pastel", label: "Pastel", src: `${A}/px-preset-pastel.png` },
  { id: "inverted", label: "Inverted", src: `${A}/px-preset-inverted.png` },
  { id: "water", label: "Water", src: `${A}/px-preset-water.png` },
];

/** A ramp as one swatch: its shades side by side, lightest on top-left. */
export function RampSwatch({ ramp, className, rounded = "rounded-[5px]" }: { ramp: string[]; className?: string; rounded?: string }) {
  const steps = ramp.slice(0, 3);
  return (
    <span className={cn("flex overflow-hidden shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14),0_1px_0_rgb(0_0_0/0.4)]", rounded, className)} aria-hidden>
      {steps.map((c, i) => (
        <span key={i} className="flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

/** The four-point twinkle every shiny gets. */
export function Twinkle({ className, style, color = "#fff" }: { className?: string; style?: React.CSSProperties; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("pointer-events-none absolute", className)} style={{ filter: `drop-shadow(0 0 6px ${color})`, ...style }} aria-hidden>
      <path d="M12 0C12.8 7.4 16.6 11.2 24 12 16.6 12.8 12.8 16.6 12 24 11.2 16.6 7.4 12.8 0 12 7.4 11.2 11.2 7.4 12 0Z" fill={color} />
    </svg>
  );
}

export function PokeballMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("pointer-events-none absolute", className)} aria-hidden>
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M4 50h30M66 50h30" stroke="currentColor" strokeWidth="3" />
      <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

/**
 * OKLCH wheel: a hue ring around a chroma × lightness plane for the current hue.
 * Colours outside sRGB are hatched out, so you can see where the screen runs out of colour.
 */
export function OklchWheel({ size = 172, h = SEL.h, c = SEL.c, l = SEL.l, ring = 13 }: { size?: number; h?: number; c?: number; l?: number; ring?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const R = size / 2;
  const rIn = R - ring;
  const side = Math.floor((rIn - 7) * Math.SQRT2);
  const x0 = R - side / 2;
  const CMAX = 0.22;
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const d = 2;
    cv.width = size * d;
    cv.height = size * d;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(cv.width, cv.height);
    const put = (i: number, rgb: number[], a: number) => {
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = a;
    };
    for (let py = 0; py < cv.height; py++) {
      for (let px = 0; px < cv.width; px++) {
        const x = (px + 0.5) / d, y = (py + 0.5) / d;
        const dx = x - R, dy = y - R, dist = Math.hypot(dx, dy);
        const i = (py * cv.width + px) * 4;
        if (dist <= R && dist >= rIn) {
          const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
          const edge = Math.min(1, R - dist + 0.5, dist - rIn + 0.5);
          put(i, oklch(0.76, 0.16, hue).rgb, 255 * edge);
          continue;
        }
        const sx = x - x0, sy = y - x0;
        if (sx >= 0 && sy >= 0 && sx <= side && sy <= side) {
          // Rounded corners.
          const rr = 7;
          const cx = Math.min(Math.max(sx, rr), side - rr), cy = Math.min(Math.max(sy, rr), side - rr);
          if (Math.hypot(sx - cx, sy - cy) > rr) continue;
          const cc = (sx / side) * CMAX;
          const ll = 1 - sy / side;
          const col = oklch(ll, cc, h);
          if (col.inside) put(i, col.rgb, 255);
          else {
            const stripe = Math.floor((x + y) / 3) % 2 === 0;
            put(i, stripe ? [44, 40, 74] : [26, 24, 48], 255);
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [size, h, R, rIn, side, x0]);
  const ha = (h * Math.PI) / 180;
  const rm = R - ring / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} className="block" aria-hidden />
      {/* Hue handle on the ring */}
      <span
        className="absolute h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5),0_2px_6px_rgb(0_0_0/0.6)]"
        style={{ left: R + rm * Math.sin(ha), top: R - rm * Math.cos(ha), background: hexOf(0.76, 0.16, h) }}
      />
      {/* Chroma × lightness handle */}
      <span
        className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.55),0_3px_8px_rgb(0_0_0/0.6)]"
        style={{ left: x0 + (c / CMAX) * side, top: x0 + (1 - l) * side, background: hexOf(l, c, h) }}
      />
    </div>
  );
}

export function GradientSlider({
  label,
  value,
  pct,
  track,
  thumb,
  compact,
}: {
  label: string;
  value: string;
  pct: number;
  track: string;
  thumb?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", compact && "space-y-1")}>
      <div className="flex items-baseline justify-between">
        <span className="hud-label">{label}</span>
        <span className="font-display text-[12px] font-semibold tabular-nums tracking-wide text-foreground/90">{value}</span>
      </div>
      <div className="relative h-3">
        <div className="absolute inset-0 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12),inset_0_1px_3px_rgb(0_0_0/0.5)]" style={{ background: track }} />
        <span
          className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5),0_2px_6px_rgb(0_0_0/0.6)]"
          style={{ left: `${pct}%`, background: thumb ?? "hsl(var(--card))" }}
        />
      </div>
    </div>
  );
}

export const HARMONIES: { id: string; label: string; hues: number[] }[] = [
  { id: "complement", label: "Complement", hues: [80, 260] },
  { id: "analogous", label: "Analogous", hues: [50, 80, 110] },
  { id: "triad", label: "Triad", hues: [80, 200, 320] },
  { id: "split", label: "Split", hues: [80, 230, 290] },
];

export function HarmonyChip({ label, hues, active }: { label: string; hues: number[]; active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md border px-2 font-display text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
        active ? "border-screen/60 bg-screen/10 text-foreground" : "border-foreground/10 bg-shade/30 text-muted-foreground hover:text-foreground"
      )}
    >
      <span className="flex -space-x-1">
        {hues.map((h, i) => (
          <span key={i} className="h-3 w-3 rounded-full ring-2 ring-card" style={{ background: hexOf(0.74, 0.14, h) }} />
        ))}
      </span>
      {label}
    </button>
  );
}

/** A small framed copy of a sprite for compare thumbnails, presets and cards. */
export function SpriteFrame({ src, pixel = true, className, imgClassName }: { src: string; pixel?: boolean; className?: string; imgClassName?: string }) {
  return (
    <span className={cn("relative block overflow-hidden", className)}>
      <img src={src} alt="" className={cn("absolute inset-0 m-auto h-full w-full object-contain", pixel && "[image-rendering:pixelated]", imgClassName)} draggable={false} />
    </span>
  );
}
