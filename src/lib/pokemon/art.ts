/** Client-safe asset URL helpers for the Pokédex. */

/**
 * A Pokémon's official artwork as WebP. Small sizes of a species (the 96 and
 * 160 px a list or a card draws) are the static 160 px file the CDN serves
 * (public/art/160, boardArtUrl), drawn down by the browser; the rest are
 * transcoded by /api/art and cached by the CDN.
 */
export function artUrl(id: number, size: 96 | 160 | 256 | 400 = 256, shiny = false): string {
  if (!shiny && size <= BOARD_ART_SIZE && hasBoardArt(id)) return boardArtUrl(id);
  return `/api/art/${id}?s=${size}${shiny ? "&shiny=1" : ""}`;
}

export function animatedSpriteUrl(id: number, shiny = false): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/showdown/${shiny ? "shiny/" : ""}${id}.gif`;
}

export function homeRenderUrl(id: number, shiny = false): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/${shiny ? "shiny/" : ""}${id}.png`;
}

export function publicCryUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;
}

export function spriteUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

/** The size of the static board pictures in public/art (scripts/board-art.ts). */
export const BOARD_ART_SIZE = 160;
/** The last National Dex number with a static board picture. */
export const BOARD_ART_LAST_ID = 1025;

/**
 * A species' 160px official artwork as a static file the CDN serves at once
 * (public/art/160, the same picture /api/art/<id>?s=160 transcodes on
 * request), for boards that show many at a time. Anything else (a form,
 * a number past the Pokédex) goes through /api/art.
 */
export function boardArtUrl(id: number): string {
  return hasBoardArt(id) ? `/art/${BOARD_ART_SIZE}/${id}.webp` : `/api/art/${id}?s=${BOARD_ART_SIZE}`;
}

/** Whether a species has a static board picture (public/art/160). */
export function hasBoardArt(id: number): boolean {
  return Number.isInteger(id) && id >= 1 && id <= BOARD_ART_LAST_ID;
}
