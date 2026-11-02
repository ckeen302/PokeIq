import sharp from "sharp";

/**
 * Official artwork as the site serves it: PokéAPI's PNG, fitted into a
 * transparent square and encoded as WebP. /api/art does this on request;
 * scripts/board-art.ts does it ahead of time for the static files in
 * public/art, so both are the same picture, byte for byte.
 */
export const OFFICIAL_ARTWORK = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";

export function officialArtworkUrl(id: number, shiny = false): string {
  return `${OFFICIAL_ARTWORK}/${shiny ? "shiny/" : ""}${id}.png`;
}

export function transcodeArt(png: Buffer, size: number): Promise<Buffer> {
  return sharp(png)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82 })
    .toBuffer();
}
