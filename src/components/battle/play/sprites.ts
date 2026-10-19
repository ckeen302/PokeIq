import { pokeapiId, spriteCandidates, type SpriteSpecies } from "@/lib/battle/sprites";
import type { SpriteData } from "./scene";

/**
 * Battle sprites from PokéAPI's sprite repo, like the rest of the site
 * (src/lib/battle/sprites.ts maps Showdown forms to PokéAPI ids). Its
 * "showdown" GIFs are Pokémon Showdown's animated sprites, so they sit on the
 * stage at Showdown's scale; the static PNGs are 96 px pixel sprites, drawn
 * at the gen 5 scale.
 *
 * Your side is seen from behind: back GIF, then back PNG, then the front
 * sprite mirrored as a last resort.
 */

const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export interface SpriteChoice {
  url: string;
  /** Mirror it (a front sprite standing in for a missing back one). */
  flip: boolean;
  animated: boolean;
}

export function battleSpriteCandidates(species: SpriteSpecies, back: boolean, shiny: boolean): SpriteChoice[] {
  const front = (flip: boolean) => spriteCandidates(species, shiny, true).map((url) => ({ url, flip, animated: url.endsWith(".gif") }));
  if (!back) return front(false);
  const ids = [...new Set([pokeapiId(species), species.num])].filter((id) => id > 0);
  const out: SpriteChoice[] = [];
  const tones = shiny ? ["shiny/", ""] : [""];
  for (const tone of tones) {
    for (const id of ids) {
      out.push({ url: `${BASE}/other/showdown/back/${tone}${id}.gif`, flip: false, animated: true });
      out.push({ url: `${BASE}/back/${tone}${id}.png`, flip: false, animated: false });
    }
  }
  return [...out, ...front(true)];
}

const preloaded = new Map<string, Promise<boolean>>();

/** Starts loading an image (once); resolves true when it's ready, false if it failed. */
export function preloadImage(url: string): Promise<boolean> {
  let p = preloaded.get(url);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    preloaded.set(url, p);
  }
  return p;
}

/** Warms the cache for a Pokémon's battle sprite: the first candidate that loads. */
export async function preloadSprite(species: SpriteSpecies, back: boolean, shiny: boolean): Promise<void> {
  for (const choice of battleSpriteCandidates(species, back, shiny).slice(0, 3)) {
    if (await preloadImage(choice.url)) return;
  }
}

/** Scene data for a sprite of natural size w×h (before it loads: a 96 px placeholder). */
export function spriteData(choice: SpriteChoice | undefined, size?: { w: number; h: number }): SpriteData {
  const animated = choice?.animated ?? false;
  return { url: choice?.url, w: size?.w ?? 96, h: size?.h ?? 96, gen: animated ? 6 : 5, pixelated: !animated };
}
