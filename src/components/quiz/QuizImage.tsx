"use client";

import Image from "next/image";
import { useState } from "react";
import type { ImageHint } from "@/engines/types";
import { cn } from "@/lib/utils";

/** Inline SVG shimmer used as blur placeholder — zero extra requests. */
const SHIMMER = `data:image/svg+xml;base64,${
  typeof btoa === "function"
    ? btoa(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#181a2b"/><rect width="400" height="400" fill="url(#g)"/><defs><linearGradient id="g"><stop stop-color="#181a2b" offset="0.2"/><stop stop-color="#242745" offset="0.5"/><stop stop-color="#181a2b" offset="0.8"/></linearGradient></defs></svg>`,
      )
    : ""
}`;

/**
 * Zero-CLS image: fixed aspect-ratio box, blur shimmer placeholder, and
 * server-directed rendering hints applied via CSS.
 *
 * `burst` renders the classic "Who's That Pokémon?" TV frame — red rays and
 * a cyan glow. Combined with hint="silhouette" the Pokémon is a dark shadow;
 * when the hint flips to "normal" on reveal, the colour fades in on the same
 * burst (the artwork is a single URL, so the reveal is instant).
 */
export function QuizImage({
  src,
  hint = "normal",
  burst = false,
  alt = "Mystery Pokémon",
}: {
  src: string;
  hint?: ImageHint;
  burst?: boolean;
  alt?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const concealed = hint === "silhouette";
  return (
    <div
      className={cn(
        "relative mx-auto aspect-square w-full max-w-64 overflow-hidden rounded-3xl border sm:max-w-72",
        burst
          ? "border-4 border-slate-900/80 shadow-2xl shadow-red-900/30"
          : "border-white/10 bg-gradient-to-b from-white/[0.07] to-transparent",
        concealed && "silhouette",
        hint === "pixelated" && "pixelated",
      )}
    >
      {burst ? (
        <>
          <div aria-hidden className="anime-burst-rays" />
          <div aria-hidden className="anime-burst-glow" />
        </>
      ) : (
        <div
          aria-hidden
          className="absolute inset-6 rounded-full bg-indigo-500/15 blur-2xl"
        />
      )}
      <Image
        src={src}
        alt={concealed ? "Mystery Pokémon silhouette" : alt}
        fill
        sizes="(max-width: 640px) 256px, 288px"
        placeholder="blur"
        blurDataURL={SHIMMER}
        className={cn(
          "object-contain p-4 transition-[opacity,filter] duration-500",
          loaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={() => setLoaded(true)}
        priority
      />
      {burst && concealed && (
        <span
          aria-hidden
          className="anime-qmark absolute right-3 top-2 select-none text-5xl font-black"
        >
          ?
        </span>
      )}
    </div>
  );
}
