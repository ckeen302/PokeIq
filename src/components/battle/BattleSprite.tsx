"use client";

/* eslint-disable @next/next/no-img-element -- remote pixel sprites with a fallback chain; next/image adds nothing here */
import { useState } from "react";
import { spriteCandidates, type SpriteSpecies } from "@/lib/battle/sprites";
import { cn } from "@/lib/utils";

/**
 * A Pokémon's sprite from PokéAPI's repo: animated if there is one, falling
 * back through the static sprite to the base species' when a form's is missing.
 */
export function BattleSprite({
  species,
  shiny = false,
  animated = true,
  size = 64,
  className,
}: {
  species: SpriteSpecies | null | undefined;
  shiny?: boolean;
  animated?: boolean;
  size?: number;
  className?: string;
}) {
  const urls = species ? spriteCandidates(species, shiny, animated) : [];
  const key = urls.join("|");
  const [failed, setFailed] = useState({ key, count: 0 });
  const index = failed.key === key ? failed.count : 0;
  const src = urls[index];

  if (!src) {
    return (
      <span
        className={cn("inline-flex items-center justify-center rounded-full border-2 border-dashed border-foreground/15", className)}
        style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2 }}
        aria-hidden
      />
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed({ key, count: index + 1 })}
      className={cn("object-contain [image-rendering:pixelated]", className)}
      style={{ width: size, height: size }}
    />
  );
}
