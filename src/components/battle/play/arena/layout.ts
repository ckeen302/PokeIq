import { projectPos, spritePosition, STAGE_H, STAGE_W } from "../scene";

/**
 * Where the 3D arena puts things, in the stage's own terms. The arena is
 * drawn behind Showdown's 640×360 stage, so its platforms have to sit
 * exactly where the sprites stand: these helpers work out, from the same
 * spritePosition/projectPos the sprites use, the point on screen under each
 * side's Pokémon and how wide its platform should look. The scene then
 * casts those points onto its floor.
 *
 * Pure (no three.js, no DOM), so it's tested on its own.
 */

/** The arena drawn for a battle. */
export type ArenaKind = "stadium" | "frontier" | "doubles" | "field";

/** The backdrop layer sits this far above the stage (Earthquake shakes it), so it is 640×450. */
export const BACKDROP_TOP = 90;
export const BACKDROP_W = STAGE_W;
export const BACKDROP_H = STAGE_H + BACKDROP_TOP;

const FRONTIER = new Set(["factory", "bssfactory", "tower"]);

/** Which arena a battle gets: Frontier halls for the Frontier, a wide arena for doubles, a field for custom rules, the stadium otherwise. */
export function arenaKindOf(format: string, doubles: boolean, frontier = false): ArenaKind {
  if (frontier || FRONTIER.has(format)) return "frontier";
  if (doubles) return "doubles";
  if (format === "custom") return "field";
  return "stadium";
}

/** A typical sprite (Showdown's animated sprites are drawn at the gen 6 scale). */
const TYPICAL = { w: 96, h: 96, gen: 6 } as const;

/** The share of a sprite's box below its feet (transparent margin): animated GIFs are trimmed close, the 96 px PNGs are not. */
export const FOOT_MARGIN = { animated: 0.04, pixel: 0.13 } as const;

export interface GroundSpot {
  /** Stage coordinates (0–640, 0–360) of the platform's centre. */
  x: number;
  y: number;
  /** How wide the platform looks on screen (stage px). */
  width: number;
}

/** The point on screen a sprite of this box stands on. */
export function footOf(box: { left: number; top: number; width: number; height: number }, pixelated: boolean) {
  return { x: box.left + box.width / 2, y: box.top + box.height * (1 - (pixelated ? FOOT_MARGIN.pixel : FOOT_MARGIN.animated)) };
}

/** The platform under one side's Pokémon: centred under where a typical sprite in each slot stands, wide enough for all of them. */
export function groundSpot(near: boolean, active: number): GroundSpot {
  const feet = Array.from({ length: Math.max(1, active) }, (_, slot) => {
    const pos = spritePosition(near, slot, active, false);
    return footOf(projectPos(pos, TYPICAL), false);
  });
  const xs = feet.map((f) => f.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  const x = xs.reduce((a, b) => a + b, 0) / xs.length;
  const y = feet.reduce((a, f) => a + f.y, 0) / feet.length;
  // A lone Pokémon's platform is about twice its sprite's width (as Showdown's backgrounds draw them).
  const base = near ? 300 : 200;
  return { x, y, width: base + spread * 1.15 };
}

/** Both platforms for a battle with `active` Pokémon a side. */
export function groundSpots(active: number) {
  return { near: groundSpot(true, active), far: groundSpot(false, active) };
}

/** A stage point in the backdrop layer's normalised device coordinates (-1…1, y up), as three.js raycasting wants. */
export function toNdc(x: number, y: number) {
  return { x: (x / BACKDROP_W) * 2 - 1, y: -(((y + BACKDROP_TOP) / BACKDROP_H) * 2 - 1) };
}

// ---------------------------------------------------------------------------
// Field effects
// ---------------------------------------------------------------------------

export type WeatherFx = "rain" | "sun" | "sand" | "snow" | null;
export type TerrainFx = "electric" | "grassy" | "psychic" | "misty" | null;

export interface ArenaField {
  weather: WeatherFx;
  /** Heavy Rain and Harsh Sunshine: more of it. */
  heavy: boolean;
  terrain: TerrainFx;
  trickRoom: boolean;
}

const WEATHER: Record<string, WeatherFx> = {
  Rain: "rain",
  "Heavy Rain": "rain",
  Sun: "sun",
  "Harsh Sunshine": "sun",
  Sand: "sand",
  Snow: "snow",
  Hail: "snow",
};

/** The snapshot's field (the names @pkmn/client gives) as the arena draws it. */
export function arenaField(weather: string, terrain: string, pseudo: readonly string[]): ArenaField {
  const t = terrain.toLowerCase();
  return {
    weather: WEATHER[weather] ?? null,
    heavy: weather === "Heavy Rain" || weather === "Harsh Sunshine",
    terrain: t === "electric" || t === "grassy" || t === "psychic" || t === "misty" ? t : null,
    trickRoom: pseudo.includes("trickroom"),
  };
}

export const sameField = (a: ArenaField, b: ArenaField) => a.weather === b.weather && a.heavy === b.heavy && a.terrain === b.terrain && a.trickRoom === b.trickRoom;
