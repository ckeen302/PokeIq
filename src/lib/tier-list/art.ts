import { ART, type Mon } from "./types";

/**
 * A roster entry's picture: HD (Pokémon HOME renders; the site's own 256 px copies where it has them, else PokéAPI's)
 * or Pixel (PokéAPI's sprites), normal or shiny. Anything missing falls back to the other style, then to the normal colours.
 */

export type ArtStyle = "hd" | "pixel";

export const SPRITE_HOST = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export function artUrl(m: Pick<Mon, "a" | "m">, style: ArtStyle, shiny: boolean): string {
  const hd = () => {
    if (shiny && m.m & ART.homeShiny) return `${SPRITE_HOST}/other/home/shiny/${m.a}.png`;
    if (m.m & ART.local) return `/sizes/art/256/${m.a}.webp`;
    if (m.m & ART.home) return `${SPRITE_HOST}/other/home/${m.a}.png`;
    return null;
  };
  const pixel = () => {
    if (shiny && m.m & ART.pixelShiny) return `${SPRITE_HOST}/shiny/${m.a}.png`;
    if (m.m & ART.pixel) return `${SPRITE_HOST}/${m.a}.png`;
    return null;
  };
  if (style === "pixel") {
    if (shiny && !(m.m & ART.pixelShiny) && m.m & ART.homeShiny) return hd()!;
    return pixel() ?? hd() ?? `${SPRITE_HOST}/${m.a}.png`;
  }
  if (shiny && !(m.m & ART.homeShiny) && m.m & ART.pixelShiny) return pixel()!;
  return hd() ?? pixel() ?? `${SPRITE_HOST}/${m.a}.png`;
}

/** Whether the picture is pixel art (drawn with crisp pixels). */
export function isPixelUrl(url: string): boolean {
  return url.startsWith(SPRITE_HOST) && !url.includes("/other/home/");
}
