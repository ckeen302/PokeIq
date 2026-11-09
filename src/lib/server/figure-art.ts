import sharp from "sharp";
import { bleedEdges } from "@/lib/world-history/bleed";

/**
 * Pokémon HOME renders as the cut-out 3D figures of the race (/pokedex/race),
 * The History of the Pokémon World and The Story of Pokémon use them: the
 * 512 px PNG fitted into a transparent square at the asked size, its edge
 * colours bled outwards (so the GPU's filtering never darkens the cut-out
 * edge) and encoded as WebP with a full-quality alpha edge.
 *
 * scripts/figure-art.ts does this ahead of time for the static files in
 * public/race/art/<size>/<id>.webp, which the pages load straight from the
 * CDN; /api/race/home and /api/world-history/art only redirect there.
 */

export const FIGURE_ART_SIZES = [256, 512] as const;
export type FigureArtSize = (typeof FIGURE_ART_SIZES)[number];

export async function transcodeFigure(png: Buffer, size: FigureArtSize): Promise<Buffer> {
  let img = sharp(png).ensureAlpha();
  if (size !== 512) img = img.resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  bleedEdges(data, info.width, info.height);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: size === 512 ? 90 : 84, alphaQuality: 100, effort: 4 }).toBuffer();
}
