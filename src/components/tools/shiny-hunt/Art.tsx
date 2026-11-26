"use client";

/* eslint-disable @next/next/no-img-element -- Pokémon pictures (the site's own renders or PokéAPI's), sized by their box */
import { useEffect, useState } from "react";
import { artUrl, boardArtUrl, homeRenderUrl } from "@/lib/pokemon/art";
import { SPRITE_HOST } from "@/lib/tier-list/art";
import type { GameId } from "@/lib/shiny-hunt/odds";
import { typeColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";

const OFFICIAL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";

/**
 * A Pokémon's picture, normal or shiny. Shiny pictures are the official artwork (the site's transcoded copy, then
 * PokéAPI's original), falling back to the HOME render and the sprite. `sm` is for grids of hundreds (the small
 * sprite), `md` for cards, `lg` for the stage.
 */
export function artSources(id: number, shiny: boolean, size: "sm" | "md" | "lg" = "lg"): string[] {
  if (!shiny) return size === "sm" ? [boardArtUrl(id), artUrl(id, 160)] : [`/sizes/art/256/${id}.webp`, homeRenderUrl(id), boardArtUrl(id)];
  const sprite = `${SPRITE_HOST}/shiny/${id}.png`;
  const official = `${OFFICIAL}/shiny/${id}.png`;
  if (size === "sm") return [sprite, artUrl(id, 160, true), homeRenderUrl(id, true)];
  return [artUrl(id, size === "md" ? 256 : 400, true), official, homeRenderUrl(id, true), sprite];
}

export function MonArt({
  id,
  shiny,
  size = "lg",
  className,
  eager,
  alt = "",
  onPalette,
}: {
  id: number;
  shiny: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
  eager?: boolean;
  alt?: string;
  /** The picture's main colour, once it loads (where the picture allows reading it). */
  onPalette?(rgb: [number, number, number] | null): void;
}) {
  const tries = artSources(id, shiny, size);
  const key = `${id}:${shiny}:${size}`;
  // A new Pokémon starts again from the best picture.
  const [st, setSt] = useState({ key, n: 0 });
  const n = st.key === key ? st.n : 0;
  const src = tries[Math.min(n, tries.length - 1)];
  const remote = src.startsWith("http");
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      {...(onPalette && remote && src.includes("raw.githubusercontent.com") && { crossOrigin: "anonymous" as const })}
      onLoad={onPalette ? (e) => onPalette(mainColour(e.currentTarget)) : undefined}
      onError={() => setSt({ key, n: Math.min(n + 1, tries.length - 1) })}
      className={cn("pointer-events-none select-none object-contain", src.includes("/sprites/pokemon/shiny/") && "[image-rendering:pixelated]", className)}
    />
  );
}

/**
 * The picture's main colour: its pixels sorted into hue buckets, weighted by how colourful they are, and the average
 * of the strongest bucket. Null when the picture can't be read (another site's, without CORS) or has no colour.
 */
function mainColour(img: HTMLImageElement): [number, number, number] | null {
  try {
    const S = 40;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, S, S);
    const d = g.getImageData(0, 0, S, S).data;
    const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.25 || max < 0.18) continue;
      let h = 0;
      if (max === r) h = ((gg - b) / (max - min)) % 6;
      else if (max === gg) h = (b - r) / (max - min) + 2;
      else h = (r - gg) / (max - min) + 4;
      const k = Math.floor((((h * 60) % 360) + 360) % 360 / 20);
      const w = sat * sat * max;
      const bk = buckets[k];
      bk.w += w;
      bk.r += d[i] * w;
      bk.g += d[i + 1] * w;
      bk.b += d[i + 2] * w;
    }
    const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
    if (best.w < 4) return null;
    return [Math.round(best.r / best.w), Math.round(best.g / best.w), Math.round(best.b / best.w)];
  } catch {
    return null;
  }
}

const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * The stage's two lights: the shiny's own main colour (once its picture loads) and its type's colour. Until the
 * picture is read, both are the type's.
 */
export function useStageColours(id: number, type: string | null): { a: string; b: string; onPalette(rgb: [number, number, number] | null): void } {
  const [pal, setPal] = useState<{ id: number; c: string | null }>({ id, c: null });
  useEffect(() => setPal({ id, c: null }), [id]);
  const b = type ? typeColor(type) : "#f6c94a";
  const a = pal.id === id && pal.c ? pal.c : b;
  return { a, b, onPalette: (rgb) => setPal({ id, c: rgb ? hex(rgb) : null }) };
}

/** Each game's two colours (its pair of versions), for its chip. */
export const GAME_COLOURS: Record<GameId, [string, string]> = {
  gsc: ["#d9a521", "#a9b1bd"],
  rse: ["#d13b3b", "#2f63c4"],
  frlg: ["#e8562a", "#5fae3c"],
  dppt: ["#5b86e0", "#e08cb2"],
  hgss: ["#e0ac2a", "#a3b7cc"],
  bw: ["#34343c", "#e4e4ea"],
  b2w2: ["#263a5a", "#dde3ec"],
  xy: ["#2f6fdc", "#de3b46"],
  oras: ["#d8342b", "#2b62c0"],
  sm: ["#f59d1c", "#6b52c8"],
  usum: ["#f2701f", "#7d42d6"],
  lgpe: ["#f7d02c", "#b98a5e"],
  swsh: ["#2fa6ea", "#e2336f"],
  bdsp: ["#4b8ff2", "#ec93bc"],
  pla: ["#caa45f", "#3f4c62"],
  sv: ["#e3352d", "#7d3fad"],
  za: ["#38c27f", "#20303f"],
};

/** A round swatch split between a game's two colours. */
export function GameSwatch({ game, className }: { game: GameId; className?: string }) {
  const [a, b] = GAME_COLOURS[game];
  return <span className={cn("inline-block shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.35),0_1px_3px_rgb(0_0_0/0.3)]", className)} style={{ background: `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` }} aria-hidden />;
}

/** A four-point sparkle. */
export function Sparkle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden fill="currentColor">
      <path d="M12 0c.6 5.6 1.9 8.6 3.6 10.1C17.3 11.6 19.6 12 24 12c-4.4 0-6.7.4-8.4 1.9C13.9 15.4 12.6 18.4 12 24c-.6-5.6-1.9-8.6-3.6-10.1C6.7 12.4 4.4 12 0 12c4.4 0 6.7-.4 8.4-1.9C10.1 8.6 11.4 5.6 12 0Z" />
    </svg>
  );
}

const STARS: { top: string; left: string; size: number; delay: number }[] = [
  { top: "8%", left: "14%", size: 18, delay: 0 },
  { top: "18%", left: "82%", size: 14, delay: 0.7 },
  { top: "62%", left: "6%", size: 12, delay: 1.3 },
  { top: "74%", left: "86%", size: 20, delay: 1.9 },
  { top: "2%", left: "56%", size: 10, delay: 2.3 },
];

/** Stars twinkling around a shiny (still under reduced motion). */
export function Twinkles({ scale = 1 }: { scale?: number }) {
  return (
    <>
      {STARS.map((s, i) => (
        <Sparkle key={i} className="sh-star" style={{ top: s.top, left: s.left, width: s.size * scale, height: s.size * scale, animationDelay: `${s.delay}s` }} />
      ))}
    </>
  );
}
