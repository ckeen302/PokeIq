/**
 * Screen-shaped views cut from the sprite games' full area maps (Red / Blue
 * to Black 2 / White 2): one place's map gives a round for each part of it a
 * fan could recognise (a Gym, a landmark, a bridge), not only the whole map
 * shrunk to fit. Views are picked where the map has the most landmark tiles
 * (rare on the map, and not the Pokémon Centers and houses every town has),
 * never on plain grass, water or cave floor, and they don't overlap.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";

/** Native screen sizes of the handhelds the sprite games ran on. */
const SCREENS = { gb: [160, 144], gba: [240, 160], ds: [256, 192] } as const;
/** A view shows this many screens across and down: enough around a landmark to place it. */
const VIEW_SCREENS = 1.5;
/** Map tiles (metatiles) are 16 px in every sprite game. */
const TILE = 16;
/** A map this many views big, or more, gives one view per this many (up to MAX_VIEWS). */
export const AREA_PER_VIEW = 2.5;
/** A place with a single shot takes a view from a smaller map: any other look at it is worth a round. */
export const AREA_PER_VIEW_THIN = 1.6;
const MAX_VIEWS = 3;
/** Views that share more than this much of their area with another, or with what the place's own shot already shows, are skipped. */
const MAX_OVERLAP = 0.2;
const MAX_SHOWN_OVERLAP = 0.5;
/** A view's flat tiles (one colour: void, open water, bare floor) and its most common tile (grass, sea) may cover at most this share of it. */
const MAX_FLAT = 0.3;
const MAX_COMMON = 0.45;
/** At least this share of a view's tiles are different from each other. */
const MIN_DISTINCT = 0.12;
/** A tile seen this often or less on the whole map is a landmark's (a building, a statue), not ground: views are ranked by those. */
const RARE = 8;
/** A view needs at least this much landmark (rare tiles, weighted) to be worth a round. */
const MIN_LANDMARK = 8;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The screen of the handheld a sprite game ran on, or null for a 3D game. */
export function screenOf(game: string): readonly [number, number] | null {
  if (/^(Red|Yellow|Gold|Silver|Crystal)\b/.test(game)) return SCREENS.gb;
  if (/^(Ruby|Sapphire|Emerald|FireRed)\b/.test(game)) return SCREENS.gba;
  if (/^(Diamond|Pearl|Platinum|HeartGold|Black)\b/.test(game)) return SCREENS.ds;
  return null;
}

/** The games whose maps share their tiles (a Pokémon Center's roof is the same in Ruby and in Emerald). */
const TILE_FAMILIES = [/^(Red|Yellow)\b/, /^(Gold|Silver|Crystal)\b/, /^(Ruby|Sapphire|Emerald)\b/, /^FireRed\b/, /^(Diamond|Pearl|Platinum)\b/, /^HeartGold\b/, /^Black\b/];
export const tileFamily = (game: string) => TILE_FAMILIES.find((re) => re.test(game))?.source ?? game;

const overlap = (a: Box, b: Box) => {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? (w * h) / (a.width * a.height) : 0;
};

/** A map cut into tiles: each tile's content as a key, and whether it is one flat colour. */
export interface TileGrid {
  width: number;
  height: number;
  cols: number;
  rows: number;
  keys: string[];
  flat: Uint8Array;
}

export function tileGrid(rgba: Buffer, width: number, height: number): TileGrid {
  const cols = Math.floor(width / TILE);
  const rows = Math.floor(height / TILE);
  const keys: string[] = new Array(cols * rows);
  const flat = new Uint8Array(cols * rows);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const hash = createHash("md5");
      const first = rgba.readUInt32LE((ty * TILE * width + tx * TILE) * 4);
      let uniform = true;
      for (let y = 0; y < TILE; y++) {
        const at = ((ty * TILE + y) * width + tx * TILE) * 4;
        const row = rgba.subarray(at, at + TILE * 4);
        hash.update(row);
        if (uniform) for (let x = 0; x < TILE; x++) if (row.readUInt32LE(x * 4) !== first) uniform = false;
      }
      keys[ty * cols + tx] = hash.digest("base64");
      flat[ty * cols + tx] = uniform || first >>> 24 < 128 ? 1 : 0;
    }
  }
  return { width, height, cols, rows, keys, flat };
}

/**
 * Tiles found on at least `minMaps` of these maps: the Pokémon Centers,
 * Marts, gatehouses and houses every town has, which don't say which place a
 * view is of.
 */
export function genericTiles(grids: TileGrid[], minMaps = 3): Set<string> {
  const maps = new Map<string, number>();
  for (const g of grids) for (const k of new Set(g.keys)) maps.set(k, (maps.get(k) ?? 0) + 1);
  return new Set([...maps].filter(([, n]) => n >= minMaps).map(([k]) => k));
}

/**
 * Up to `max` views of a map at its native scale (one source pixel per game
 * pixel), best first. `shown` is the part of the map its whole-map shot keeps
 * (the middle of a long route), which views mostly avoid; `generic` tiles
 * don't count as landmarks; `taken` are views cut from the map before.
 */
export function pickViews(
  grid: TileGrid,
  screen: readonly [number, number],
  max = MAX_VIEWS,
  shown?: Box,
  generic?: ReadonlySet<string>,
  taken: Box[] = [],
  areaPerView = AREA_PER_VIEW
): Box[] {
  const { width, height, cols, rows, keys, flat } = grid;
  let [vw, vh] = screen.map((s) => Math.round((s * VIEW_SCREENS) / TILE) * TILE);
  // A narrow map (a corridor of a route) takes a smaller view, down to one screen.
  const fit = Math.min(1, width / vw, height / vh);
  if (fit * VIEW_SCREENS < 1) return [];
  [vw, vh] = [Math.floor((vw * fit) / TILE) * TILE, Math.floor((vh * fit) / TILE) * TILE];
  const count = Math.min(max, Math.floor((width * height) / (vw * vh) / areaPerView));
  if (count < 1) return [];
  const uses = new Map<string, number>();
  for (const k of keys) uses.set(k, (uses.get(k) ?? 0) + 1);

  const [cw, ch] = [vw / TILE, vh / TILE];
  const scored: { box: Box; score: number }[] = [];
  for (let ty = 0; ty + ch <= rows; ty++) {
    for (let tx = 0; tx + cw <= cols; tx++) {
      const counts = new Map<string, number>();
      let flats = 0;
      for (let y = ty; y < ty + ch; y++) {
        for (let x = tx; x < tx + cw; x++) {
          const i = y * cols + x;
          if (flat[i]) flats++;
          else counts.set(keys[i], (counts.get(keys[i]) ?? 0) + 1);
        }
      }
      const cells = cw * ch;
      const common = Math.max(0, ...counts.values());
      if (flats / cells > MAX_FLAT || common / cells > MAX_COMMON || counts.size / cells < MIN_DISTINCT) continue;
      let score = 0;
      for (const k of counts.keys()) if (!generic?.has(k)) score += Math.min(1, RARE / uses.get(k)!);
      if (score >= MIN_LANDMARK) scored.push({ box: { left: tx * TILE, top: ty * TILE, width: vw, height: vh }, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  // A whole-map shot that shows all of the map: views are close-ups of it, anywhere.
  const cut = shown && (shown.width < width || shown.height < height) ? shown : undefined;
  // Views cut earlier (kept or not) aren't offered again, nor much of them.
  const picked: Box[] = [...taken];
  for (const { box } of scored) {
    if (picked.length - taken.length >= count) break;
    if (cut && overlap(box, cut) > MAX_SHOWN_OVERLAP) continue;
    if (picked.some((p) => overlap(box, p) > MAX_OVERLAP)) continue;
    picked.push(box);
  }
  return picked.slice(taken.length);
}

/** A source image at native scale (each game pixel once), as RGBA. */
export async function nativePixels(source: Buffer, scale: number): Promise<{ rgba: Buffer; width: number; height: number }> {
  const meta = await sharp(source).metadata();
  const [width, height] = [Math.floor((meta.width ?? 0) / scale), Math.floor((meta.height ?? 0) / scale)];
  const rgba = await sharp(source)
    .extract({ left: 0, top: 0, width: width * scale, height: height * scale })
    .resize(width, height, { kernel: "nearest" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return { rgba, width, height };
}
