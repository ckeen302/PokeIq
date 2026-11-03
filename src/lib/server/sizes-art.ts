import sharp from "sharp";

/**
 * Pokémon HOME renders as the 3D figures on /pokedex/sizes use them: the
 * 512 px PNG, fitted into a transparent square at the asked size and
 * encoded as WebP with a lossless-quality alpha edge (the figures are cut
 * out by it). /api/sizes/home does this on request; scripts/sizes-art.ts
 * does it ahead of time for the static files in public/sizes/art, so both
 * are the same picture, byte for byte.
 */

/** Sizes the route serves. */
export const HOME_SIZES = [128, 256, 512] as const;
export type HomeSize = (typeof HOME_SIZES)[number];

/** Sizes kept as static files (public/sizes/art/<size>/<id>.webp): what the figures load. */
export const STATIC_HOME_SIZES = [256, 512] as const;

export function transcodeHome(png: Buffer, size: HomeSize): Promise<Buffer> {
  let img = sharp(png);
  if (size !== 512) img = img.resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  return img.webp({ quality: size === 512 ? 90 : 84, alphaQuality: 100, effort: 4 }).toBuffer();
}
