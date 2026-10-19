import SPRITES from "@/data/battle-sprites.json";

/**
 * Sprite URLs for Showdown species, from PokéAPI's sprite repo like the rest
 * of the site. Forms map to PokéAPI's own ids (scripts/battle-sprites.ts);
 * ids with no animated sprite skip straight to the static one.
 */

const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const FORMS: Record<string, number> = SPRITES.forms;
const NO_GIF = new Set<number>(SPRITES.noGif);

export interface SpriteSpecies {
  /** Showdown id, e.g. "rotomwash". */
  id: string;
  /** National Dex number. */
  num: number;
}

/** PokéAPI's id for a species or form (forms PokéAPI lacks use their base species). */
export function pokeapiId(species: SpriteSpecies): number {
  return FORMS[species.id] ?? species.num;
}

/** Best first: animated, then static, then the base species' if the form's are missing. */
export function spriteCandidates(species: SpriteSpecies, shiny = false, animated = true): string[] {
  const ids = [...new Set([pokeapiId(species), species.num])].filter((id) => id > 0);
  const urls: string[] = [];
  for (const id of ids) {
    if (animated && !NO_GIF.has(id)) urls.push(`${BASE}/other/showdown/${shiny ? "shiny/" : ""}${id}.gif`);
    urls.push(`${BASE}/${shiny ? "shiny/" : ""}${id}.png`);
  }
  // A shiny sprite that's missing falls back to the regular one.
  if (shiny) urls.push(...spriteCandidates(species, false, animated));
  return [...new Set(urls)];
}
