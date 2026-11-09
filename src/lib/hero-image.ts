/**
 * The home hero's fixed picture, pre-sized: the widths Next's image
 * optimizer would make of it (src/assets/guessr/<name>.webp at quality 75,
 * byte for byte), kept as static files in public/home by
 * scripts/hero-sizes.ts, so the CDN serves them without a function.
 */
export const HERO_WIDTHS = [640, 750, 828, 1080, 1200, 1280] as const;

/** next/image loader: the smallest pre-sized file at least this wide (the source's own width for wider screens). */
export function heroLoader({ src, width }: { src: string; width: number }): string {
  const name = /\/([a-z0-9-]+)\.[0-9a-f]+\.webp$/.exec(src)?.[1] ?? /\/([a-z0-9-]+)\.webp$/.exec(src)?.[1] ?? "paldea";
  const w = HERO_WIDTHS.find((x) => x >= width) ?? HERO_WIDTHS[HERO_WIDTHS.length - 1];
  return `/home/${name}-${w}.webp`;
}
