/**
 * The Pokédex entry's sprites table: one representative game per generation,
 * front sprite, normal and shiny, from PokéAPI's sprite repository (the same
 * GitHub host the rest of the site's sprites come from). Which files exist is
 * recorded once in src/data/dex-sprites.json (scripts/dex-sprites.ts), so a
 * page never guesses at a URL that 404s.
 */

export const SPRITE_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

/** How a generation's sprite is drawn in its 96 px cell. */
export type SpriteLook =
  /** Pixel art, scaled by a fixed factor (crisp); a canvas bigger than the cell is cropped evenly (its sprite sits in the middle). */
  | { kind: "pixel"; size: number }
  /** A 3D render cut to its own size: drawn as is, shrunk to fit if it's bigger than the cell. */
  | { kind: "render" }
  /** Pokémon HOME's 512 px model, shown scaled down (the site's own 256 px copy where it has one). */
  | { kind: "home" };

export interface SpriteSource {
  gen: number;
  /** The game the sprite is from, as the column shows it. */
  game: string;
  /** Folders under sprites/pokemon; shiny is null where the game has none (Gen 1, Sword & Shield's icons). */
  normal: string;
  shiny: string | null;
  ext: "png" | "gif";
  look: SpriteLook;
}

/** The cell's sprite area, in CSS px. */
export const SPRITE_CELL = 96;

export const SPRITE_SOURCES: readonly SpriteSource[] = [
  // 96 px canvas around a ≤56 px sprite: 1.5× keeps the middle 64 px in the cell.
  { gen: 1, game: "Red & Blue", normal: "versions/generation-i/red-blue/transparent", shiny: null, ext: "png", look: { kind: "pixel", size: 144 } },
  { gen: 2, game: "Crystal", normal: "versions/generation-ii/crystal/transparent", shiny: "versions/generation-ii/crystal/transparent/shiny", ext: "png", look: { kind: "pixel", size: 84 } },
  { gen: 3, game: "Emerald", normal: "versions/generation-iii/emerald", shiny: "versions/generation-iii/emerald/shiny", ext: "png", look: { kind: "pixel", size: 96 } },
  { gen: 4, game: "Platinum", normal: "versions/generation-iv/platinum", shiny: "versions/generation-iv/platinum/shiny", ext: "png", look: { kind: "pixel", size: 80 } },
  { gen: 5, game: "Black & White", normal: "versions/generation-v/black-white", shiny: "versions/generation-v/black-white/shiny", ext: "png", look: { kind: "pixel", size: 96 } },
  { gen: 6, game: "X & Y", normal: "versions/generation-vi/x-y", shiny: "versions/generation-vi/x-y/shiny", ext: "png", look: { kind: "render" } },
  { gen: 7, game: "Ultra Sun & Moon", normal: "versions/generation-vii/ultra-sun-ultra-moon", shiny: "versions/generation-vii/ultra-sun-ultra-moon/shiny", ext: "gif", look: { kind: "render" } },
  // Sword & Shield drew no sprites, only menu icons (68 px canvas, the icon in the middle).
  { gen: 8, game: "Sword & Shield", normal: "versions/generation-viii/sword-shield/icons", shiny: null, ext: "png", look: { kind: "pixel", size: 102 } },
  { gen: 9, game: "Pokémon HOME", normal: "other/home", shiny: "other/home/shiny", ext: "png", look: { kind: "home" } },
];

export const LAST_SPRITE_GEN = SPRITE_SOURCES[SPRITE_SOURCES.length - 1].gen;

export function spritePath(src: SpriteSource, id: number, shiny: boolean): string | null {
  const dir = shiny ? src.shiny : src.normal;
  return dir ? `${dir}/${id}.${src.ext}` : null;
}

/**
 * A species' row in the manifest: one character per generation from Gen 1,
 * "-" before it existed, else a digit whose bit 1 says the normal sprite
 * exists and bit 2 the shiny one ("3" both, "1" normal only, "0" neither).
 */
export type SpriteCode = string;

export const NORMAL_BIT = 1;
export const SHINY_BIT = 2;

export interface SpriteColumn {
  gen: number;
  game: string;
  look: SpriteLook;
  normal: string | null;
  shiny: string | null;
}

/** The table's columns for one species: its debut generation onward, each with the URLs that exist (null shows a dash). */
export function spriteColumns(id: number, code: SpriteCode): SpriteColumn[] {
  const cols: SpriteColumn[] = [];
  for (const src of SPRITE_SOURCES) {
    const ch = code[src.gen - 1];
    if (ch === undefined || ch === "-") continue;
    const bits = Number(ch);
    const url = (shiny: boolean, bit: number) => {
      const path = bits & bit ? spritePath(src, id, shiny) : null;
      return path ? `${SPRITE_BASE}/${path}` : null;
    };
    cols.push({ gen: src.gen, game: src.game, look: src.look, normal: url(false, NORMAL_BIT), shiny: url(true, SHINY_BIT) });
  }
  return cols;
}
