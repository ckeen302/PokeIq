import "server-only";
import data from "@/data/zoom-reveal-crops.json";
import type { MediaRef } from "@/engines/types";
import { NEA_CATEGORIES } from "@/lib/name-em-all/categories";
import { buildMatcher, matchName, type NeaMatcher } from "@/lib/name-em-all/match";
import { neaTargets } from "@/lib/name-em-all/targets";
import { ZOOM_STEPS, innerRect, stepWindow, type ZoomView, type ZoomWindow } from "@/lib/zoom-reveal";
import { mediaUrl } from "./media-url";

/**
 * Zoom Reveal on the server: the precomputed start crops (keyed by species,
 * so this never reaches the browser), each step's opaque media URL, and the
 * forgiving name check used to grade a typed guess.
 */

const CROPS = (data as { crops: Record<string, number[][]> }).crops;

/** Every Pokémon with a start crop (all 1,025). */
export const hasZoomCrops = (id: number): boolean => (CROPS[id]?.length ?? 0) > 0;

export const zoomCropCount = (id: number): number => CROPS[id]?.length ?? 0;

/** Start crop `crop` of a Pokémon (wrapping, so any index is valid). */
export function zoomStart(id: number, crop: number): ZoomWindow {
  const list = CROPS[id];
  if (!list?.length) return { x: 0, y: 0, s: 1 };
  const [x, y, s] = list[((crop % list.length) + list.length) % list.length];
  return { x, y, s };
}

export function zoomStepWindow(id: number, crop: number, step: number): ZoomWindow {
  return stepWindow(zoomStart(id, crop), step);
}

/** The browser's view of step `step` of a Zoom Reveal media ref. */
export function zoomView(media: MediaRef, step: number): ZoomView {
  const s = Math.min(ZOOM_STEPS, Math.max(1, step));
  const crop = media.crop ?? 0;
  const view: ZoomView = { step: s, steps: ZOOM_STEPS, url: mediaUrl({ ...media, step: s }) };
  if (s > 1) view.from = innerRect(zoomStepWindow(media.pokemonId, crop, s - 1), zoomStepWindow(media.pokemonId, crop, s));
  return view;
}

// ---------------------------------------------------------------------------
// Name check: Name 'em All's accepted spellings (accents, punctuation, the
// Nidoran / Farfetch'd aliases) plus its form spellings ("Alolan Vulpix"),
// which name the species the artwork shows.
// ---------------------------------------------------------------------------

let matchers: { matcher: NeaMatcher; species: number[] }[] | null = null;

function allMatchers() {
  if (!matchers) {
    const ids = ["all", ...NEA_CATEGORIES.filter((c) => c.group === "forms").map((c) => c.id)];
    matchers = ids.flatMap((id) => {
      const targets = neaTargets(id);
      return targets ? [{ matcher: buildMatcher(targets), species: targets.map((t) => t.species) }] : [];
    });
  }
  return matchers;
}

/** The species a typed guess names, or undefined. */
export function guessedSpecies(guess: string): number | undefined {
  for (const { matcher, species } of allMatchers()) {
    const slot = matchName(matcher, guess);
    if (slot !== undefined) return species[slot];
  }
  return undefined;
}
