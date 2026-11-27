import "server-only";
import { SIZE_BY_KEY } from "@/lib/sizes/data";
import { dims, layoutLine } from "@/lib/sizes/types";

/**
 * What the hero's visuals need of a Pokémon: its HOME render (the same files
 * /pokedex/sizes and the Professor's Lab draw), the render's visible box and
 * its documented size (lib/sizes/data: the Pokédex's heights, or the length
 * of a long Pokémon such as Wailord).
 */
export interface HeroMon {
  key: string;
  name: string;
  /** PokéAPI id of the HOME render. */
  art: number;
  /** World size (m) of the figure's box. */
  w: number;
  h: number;
  /** The documented size (m). */
  m: number;
  length: boolean;
  /** The render's visible box: x, y, w, h in an image `size` px square. */
  box: [number, number, number, number, number];
  types: string[];
}

export function heroMon(key: string): HeroMon {
  const i = SIZE_BY_KEY.get(key);
  if (!i || i.art <= 0) throw new Error(`lab hero: no figure for ${key}`);
  const d = dims(i);
  return { key: i.key, name: i.name, art: i.art, w: d.w, h: d.h, m: i.m, length: i.length, box: [i.bx, i.by, i.bw, i.bh, i.bs || 512], types: i.types };
}

/** Option 1: Pokémon whose relief figures hold up best turning on the pedestal. */
export const PEDESTAL_KEYS = ["charizard", "pikachu", "gengar", "lucario", "dragonite", "mewtwo", "eevee"] as const;

/** Option 2: the parade, smallest first (it walks left, so the smallest leads), and the giant passing behind. */
export const PARADE_KEYS = ["joltik", "eevee", "pikachu", "charmander", "lucario", "gengar", "charizard", "snorlax", "dragonite"] as const;
export const PARADE_GIANT = "wailord";

/** Option 3: silhouettes the portal materialises, one after another. */
export const PORTAL_KEYS = ["mewtwo", "charizard", "gengar", "lucario", "pikachu", "dragonite"] as const;

/** The parade's line: each figure's centre (m) from the line's start, the site's own spacing (lib/sizes layoutLine). */
export function paradeLine(mons: HeroMon[]): { mon: HeroMon; x: number }[] {
  const line = layoutLine(mons.map((m) => ({ m: m.m, length: m.length, bw: m.box[2], bh: m.box[3] })));
  return mons.map((mon, i) => ({ mon, x: line[i].x }));
}
