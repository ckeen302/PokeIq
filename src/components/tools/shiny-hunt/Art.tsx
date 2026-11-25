"use client";

/* eslint-disable @next/next/no-img-element -- Pokémon pictures (the site's own renders or PokéAPI's), sized by their box */
import { useState } from "react";
import { artUrl, boardArtUrl, homeRenderUrl } from "@/lib/pokemon/art";
import { SPRITE_HOST } from "@/lib/tier-list/art";
import { cn } from "@/lib/utils";

/**
 * A Pokémon's picture, normal or shiny: the Pokémon HOME render (the site's own copy for normal colours), falling back
 * to the shiny sprite, then the site's transcoded artwork. Shiny pictures come from PokéAPI's public sprites.
 */
export function artSources(id: number, shiny: boolean, size: "sm" | "lg" = "lg"): string[] {
  if (!shiny) return size === "sm" ? [boardArtUrl(id), artUrl(id, 160)] : [`/sizes/art/256/${id}.webp`, homeRenderUrl(id), boardArtUrl(id)];
  const sprite = `${SPRITE_HOST}/shiny/${id}.png`;
  // Lists draw the small sprite (a few KB); the big picture is the HOME render.
  return size === "sm" ? [sprite, homeRenderUrl(id, true), artUrl(id, 256, true)] : [homeRenderUrl(id, true), sprite, artUrl(id, 256, true)];
}

export function MonArt({ id, shiny, size = "lg", className, eager, alt = "" }: { id: number; shiny: boolean; size?: "sm" | "lg"; className?: string; eager?: boolean; alt?: string }) {
  const tries = artSources(id, shiny, size);
  const key = `${id}:${shiny}:${size}`;
  // A new Pokémon starts again from the best picture.
  const [st, setSt] = useState({ key, n: 0 });
  const n = st.key === key ? st.n : 0;
  const src = tries[Math.min(n, tries.length - 1)];
  return (
    <img
      key={src}
      src={src}
      alt={alt}
      draggable={false}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setSt({ key, n: Math.min(n + 1, tries.length - 1) })}
      className={cn("pointer-events-none select-none object-contain", src.includes("/sprites/pokemon/shiny/") && "[image-rendering:pixelated]", className)}
    />
  );
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
