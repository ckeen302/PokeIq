import type { SceneItem } from "@/components/sizes/scene/figures";

/** One Pokémon on the lab's wheel (what the page sends the client: the scene's figure and the panels' numbers). */
export interface LabEntry {
  id: number;
  name: string;
  genus: string;
  gen: number;
  types: string[];
  /** hp, atk, def, spa, spd, spe. */
  stats: [number, number, number, number, number, number];
  bst: number;
  heightM: number;
  weightKg: number;
  /** The HOME render's visible box [x, y, w, h, image size] (src/data/sizes-art.json). */
  box: [number, number, number, number, number];
  flavor: string;
  abilities: string[];
}

/**
 * A figure for the scene, at display size rather than real size: a pod holds
 * anything from Eevee to Dragonite, so heights are compressed (bigger
 * Pokémon still stand taller) and wide ones are fitted to the glass.
 */
export function labItem(e: LabEntry, opts: { hero?: boolean } = {}): SceneItem {
  const [, , bw, bh] = e.box;
  const aspect = bw / bh;
  let h: number;
  if (opts.hero) {
    // The holo-table magnifies: everyone stands about as tall, the big ones a little taller, never wider than the table.
    h = Math.min(2.05 + 0.32 * Math.log2(Math.max(0.3, e.heightM) / 0.6), 3.0 / aspect, 2.9);
  } else {
    h = Math.min(0.78 + 0.26 * Math.log2(Math.max(0.3, e.heightM) / 0.4), 1.16 / aspect, 1.42);
  }
  return {
    key: `lab-${e.id}${opts.hero ? "-hero" : ""}`,
    name: e.name,
    kind: "pokemon",
    art: e.id,
    species: e.id,
    m: e.heightM,
    length: false,
    min: false,
    w: h * aspect,
    h,
    box: e.box,
    types: e.types,
  };
}
