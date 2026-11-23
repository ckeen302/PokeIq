/**
 * Pokémon Hunt: the contract between the game, the answer data and the screens.
 * See docs/hunt/spec.md. Changes to this file go through the game agent.
 *
 * Client safe: nothing here holds an answer. The answer table itself
 * (src/data/hunt/answers.json) is read only on the server (src/lib/server/hunt.ts).
 */

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/**
 * The regions a Hunt counts. One pin per region, at most HUNT_MAX_PINS.
 * The map's own sub-areas fold into these the way PokéGuessr folds them:
 * Sevii Islands → kanto, Isle of Armor and Crown Tundra → galar,
 * Blueberry Academy → unova. Kitakami is its own region (it has no region
 * map of its own, so it only comes up on the world map).
 */
export const HUNT_REGIONS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea", "kitakami"] as const;
export type HuntRegionId = (typeof HUNT_REGIONS)[number];
export const isHuntRegion = (v: unknown): v is HuntRegionId => HUNT_REGIONS.includes(v as HuntRegionId);

/** The `region` field of a place in src/data/geo.json → the Hunt region it counts as. */
export const HUNT_REGION_OF_GEO: Record<string, HuntRegionId> = {
  Kanto: "kanto",
  "Sevii Islands": "kanto",
  Johto: "johto",
  Hoenn: "hoenn",
  Sinnoh: "sinnoh",
  Unova: "unova",
  "Blueberry Academy": "unova",
  Kalos: "kalos",
  Alola: "alola",
  Galar: "galar",
  "Isle of Armor": "galar",
  "Crown Tundra": "galar",
  Paldea: "paldea",
  Kitakami: "kitakami",
};

/** Regions with a map of their own (geo.json `world.crops`): the ones Region mode offers. */
export const HUNT_MAP_REGIONS = ["kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"] as const satisfies readonly HuntRegionId[];
export type HuntMapRegionId = (typeof HUNT_MAP_REGIONS)[number];
export const isHuntMapRegion = (v: unknown): v is HuntMapRegionId => HUNT_MAP_REGIONS.includes(v as HuntMapRegionId);

// ---------------------------------------------------------------------------
// The answer table: src/data/hunt/answers.json (owned by "hunt data")
// ---------------------------------------------------------------------------

/** One way to meet the Pokémon at a place: "Red / Blue · Super Rod". */
export interface HuntMethod {
  /** Version keys from src/lib/pokemon/encounter-types.ts VERSIONS, in game order ("red", "blue"). */
  versions: string[];
  /** The games as the reveal labels them, joined with " / " ("Red / Blue", "Sword / Shield"). */
  games: string;
  /** The method as the reveal labels it ("Super Rod", "Grass", "Max Raid", "Fixed encounter"). */
  method: string;
}

/** A real spot on the map where this exact form can be met. */
export interface HuntPlace {
  /** The Hunt region it counts toward. */
  region: HuntRegionId;
  /** The place exactly as src/data/geo.json `world.locations` names it: its `region` and `name` (never a building, always a pinned place). */
  geoRegion: string;
  name: string;
  /** Copied from geo.json (world map 0–1), so tests can check it; the server reads the area (mask) from geo.json itself. */
  pin: [number, number];
  /** Every game and method that puts it here (at least one). */
  methods: HuntMethod[];
}

/** One round's worth of answer: a species in one exact form. */
export interface HuntEntry {
  /** Stable key: the National Dex number, then the form ("52", "52-alola", "52-galar", "128-paldea-blaze"). */
  id: string;
  dex: number;
  /** The form's slug (null for the base form). */
  form: string | null;
  /** English name with the form, as the round card shows it ("Alolan Meowth", "Meowth"). */
  name: string;
  /** The art: a PokéAPI Pokémon id for /api/art/<id> (the species' number for the base form, 10000+ for other forms). */
  art: number;
  /** The Pokédex page: /pokemon/<slug>#encounters. */
  slug: string;
  /** The regions it's found in, in HUNT_REGIONS order, no repeats. Equal to the set of its places' regions. */
  regions: HuntRegionId[];
  /** Every real spot (all on the map: rule 4). */
  places: HuntPlace[];
  /**
   * Measured difficulty, 0 (easy) – 1 (hard), on the world map with the pins it gets:
   * 1 − the share of the map's land where the pins would score well.
   */
  difficulty: number;
  /** Per region map: the same measure on that region's own map with one pin (only for regions it's found in). */
  regionDifficulty: Partial<Record<HuntMapRegionId, number>>;
  /** A famous, memorable spot (Snorlax on Route 12, Lapras in Union Cave, Mewtwo in Cerulean Cave). */
  famous?: boolean;
  /** Found nearly everywhere: never dealt in world mode (Classic, Daily), still fine in a region it's rare in. */
  everywhere?: boolean;
  /** The reveal's one-line fact (English), taken from the data, never invented. Optional: the game writes one from the places when absent. */
  fact?: string;
}

export interface HuntAnswerFile {
  version: 1;
  /** True while this is the game agent's hand-checked sample, not the full table. */
  sample?: boolean;
  generatedAt: string;
  entries: HuntEntry[];
}

// ---------------------------------------------------------------------------
// Modes and rules
// ---------------------------------------------------------------------------

export const HUNT_MODES = ["classic", "region", "daily"] as const;
export type HuntMode = (typeof HUNT_MODES)[number];
export const isHuntMode = (v: unknown): v is HuntMode => HUNT_MODES.includes(v as HuntMode);

export const HUNT_ROUNDS = 5;
export const HUNT_MAX_PINS = 3;
export const HUNT_MAX_ROUND_SCORE = 5000;
/** Every round is timed: PokéGuessr's 1:30. */
export const HUNT_TIMER_S = 90;
/** The first Daily Hunt (its number counts from here). */
export const HUNT_DAILY_FROM = "2026-11-23";
/** The Daily's leaderboard needs a table (see docs/hunt/spec.md): off until one exists. */
export const HUNT_DAILY_LEADERBOARD = false;

/** Pins a round takes: one per region it's found in, at most three, on the world map; one on a region's map. */
export const huntPinsFor = (regions: number, mode: HuntMode): number => (mode === "region" ? 1 : Math.max(1, Math.min(HUNT_MAX_PINS, regions)));

/** A game as the client asks for it. */
export interface HuntSpec {
  mode: HuntMode;
  /** Region mode: the map. */
  region?: HuntMapRegionId;
  /** Daily: the date (YYYY-MM-DD, UTC), set by the server. */
  daily?: string;
}

// ---------------------------------------------------------------------------
// The API: POST /api/geo/hunt (start) and POST /api/geo/hunt/guess
// ---------------------------------------------------------------------------

/** What a round shows before the reveal. No place, no region names (in Region mode only the map's own). */
export interface HuntRoundPublic {
  index: number;
  /** The entry's key ("52-alola"): says which Pokémon, which the card shows anyway, never where. */
  id: string;
  dex: number;
  name: string;
  /** The art URL for this exact form. */
  art: string;
  /** How many regions it's found in (world maps), or 1 on a region's map. */
  regions: number;
  /** How many pins this round takes. */
  pins: number;
}

export interface HuntStartRequest {
  mode: HuntMode;
  region?: HuntMapRegionId;
  /** Daily: the player's local date (YYYY-MM-DD), like every daily on the site (the server allows a day either side of UTC). */
  date?: string;
  /** Entry ids the player saw lately, most recent first (free play deals fresh ones first). */
  recent?: string[];
  name?: string;
}

export interface HuntStartResponse {
  token: string;
  mode: HuntMode;
  /** The map played: "world", or the region's id. */
  map: "world" | HuntMapRegionId;
  rounds: number;
  /** Seconds per round. */
  timer: number;
  daily?: { date: string; number: number };
  round: HuntRoundPublic;
}

/** A pin as the client sends it: the map's own 0–1 coordinates. */
export interface HuntPin {
  x: number;
  y: number;
}

export interface HuntGuessRequest {
  token: string;
  pins: HuntPin[];
  /** The clock ran out (pins down by then still count). */
  timeout?: boolean;
}

/** One real spot, as the reveal draws it (the map's own 0–1 coordinates). */
export interface HuntSpot {
  region: HuntRegionId;
  name: string;
  pin: [number, number];
  /** The place's area (the map's own 0–1 coordinates). */
  mask: [number, number][];
  /** "Red / Blue · Super Rod", one per game and method. */
  labels: string[];
  /** The same, as game and method apart. */
  methods: { games: string; method: string }[];
}

/** How one pin did: the region it was matched to, its nearest spot there, its points. */
export interface HuntPinResult {
  pin: HuntPin;
  /** Null: more pins than regions on the map (cannot happen: the client is held to `pins`), or the pin was off the map. */
  region: HuntRegionId | null;
  /** Index into HuntReveal.spots of the nearest spot in that region. */
  spot: number | null;
  /** Map pixels to that spot's area (0 inside it). */
  distancePx: number;
  score: number;
  /** The pin landed in that region. */
  found: boolean;
}

export interface HuntReveal {
  id: string;
  name: string;
  /** Every real spot, grouped by region in HUNT_REGIONS order (the reveal pops them region by region). */
  spots: HuntSpot[];
  regions: HuntRegionId[];
  pins: HuntPinResult[];
  /** Regions found, out of the pins the round took: "You found 2 of 3 regions". */
  found: number;
  of: number;
  fact: string;
  /** The Pokédex's "where to find" section: /pokemon/<slug>#encounters. */
  dex: string;
}

export interface HuntResultRound {
  id: string;
  name: string;
  art: string;
  score: number;
  found: number;
  of: number;
}

export interface HuntResult {
  sid: string;
  spec: HuntSpec;
  score: number;
  max: number;
  rounds: HuntResultRound[];
  durationMs: number;
}

export interface HuntGuessResponse {
  score: number;
  total: number;
  timedOut?: boolean;
  reveal: HuntReveal;
  token: string;
  next?: HuntRoundPublic;
  done: boolean;
  result?: HuntResult;
}
