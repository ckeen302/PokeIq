import SIZES_ART from "@/data/sizes-art.json";
import RACE_FORMS from "@/data/race-forms.json";

/**
 * Where a figure's pieces live. Every legendary is a relief figure built
 * the way /pokedex/sizes builds them: the Pokémon HOME render on a relief
 * mesh from a baked depth map. Species and most forms have their map in
 * public/sizes/depth; the forms only /pokedex/race shows (Primal Groudon,
 * Origin Dialga…) have theirs in public/race/depth, baked by the same
 * pipeline. The render's visible box comes from the same data.
 */

type Box = [number, number, number, number, number];

const SIZES_BOX = SIZES_ART as unknown as Record<string, Box>;
const FORM_BOX = new Map<number, Box>(
  ((RACE_FORMS as unknown as { forms: { id: number; box?: Box }[] }).forms ?? []).filter((f) => f.box).map((f) => [f.id, f.box as Box])
);

export interface FigureAsset {
  art: number;
  /** The render's visible box [x, y, w, h, image size]. */
  box: Box;
  /** The relief map (same-origin, static). */
  relief: string;
  /** Which baked set the map is in. */
  set: "sizes" | "race";
}

export function figureAsset(art: number): FigureAsset | null {
  const sizes = SIZES_BOX[String(art)];
  if (sizes) return { art, box: sizes, relief: `/sizes/depth/${art}.webp`, set: "sizes" };
  const form = FORM_BOX.get(art);
  if (form) return { art, box: form, relief: `/race/depth/${art}.webp`, set: "race" };
  return null;
}

/** The HOME render for a figure, same-origin for WebGL (see /api/world-history/art). */
export function artUrl(art: number, size: 256 | 512 = 512): string {
  return `/api/world-history/art/${art}?s=${size}`;
}
