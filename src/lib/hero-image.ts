/**
 * The home banner's pictures (the classroom: Alakazam teaching), one pair per
 * theme: a night-time classroom for the dark theme, a daytime one for the
 * light theme. Static WebP files in public/home, so the CDN serves them
 * without a function; the wider sizes are upscaled from the sources with
 * ffmpeg:
 *
 *   ffmpeg -i <source> -vf "scale=<w>:-2:flags=lanczos,unsharp=5:5:0.6" -c:v libwebp -quality 82 -frames:v 1 public/home/<name>-<w>.webp
 *
 * A phone gets the tall picture, anything from 640 px up the wide one; the
 * <picture>'s <source> and <img> read `media`, `srcSet` and `sizes` from here.
 */

/** Under this width (px) a screen gets the tall picture; Tailwind's `sm`. */
const PHONE_MAX = 639;

export type HeroImage = { src: string; srcSet: string; sizes: string; width: number; height: number; media: string };
export type HeroPair = { tall: HeroImage; wide: HeroImage };

const files = (name: string, widths: number[]) => widths.map((w) => `/home/${name}-${w}.webp ${w}w`).join(", ");

function pair(prefix: string): HeroPair {
  return {
    // A phone: the picture runs edge to edge, 400 px tall, so it's drawn as wide as the screen.
    tall: { src: `/home/${prefix}tall-828.webp`, srcSet: files(`${prefix}tall`, [828, 1240]), sizes: "100vw", width: 828, height: 1028, media: `(max-width: ${PHONE_MAX}px)` },
    // The card covers its box: up to 1152 px wide on a desktop, about 990 px wide (cropped from the left) on a tablet.
    wide: { src: `/home/${prefix}wide-1600.webp`, srcSet: files(`${prefix}wide`, [1024, 1600, 2048]), sizes: "(min-width: 1024px) 1152px, 992px", width: 1600, height: 678, media: `(min-width: ${PHONE_MAX + 1}px)` },
  };
}

export const HERO_IMAGES: Record<"dark" | "light", HeroPair> = {
  dark: pair("classroom-"),
  light: pair("classroom-day-"),
};
