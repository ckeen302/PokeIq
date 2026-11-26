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
 * The regions a Hunt counts. The map's own sub-areas fold into these the way PokéGuessr folds them:
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

/**
 * The scoring curve's length scale for a spot in each region (world pixels): the diagonal of that
 * region's own map (geo.json `world.crops`), so a pin is scored as PokéGuessr scores one on that map.
 * A region with no map of its own (Kitakami) takes the mean of the others.
 */
export function huntScales(crops: Record<string, { box: [number, number, number, number] }>): Record<HuntRegionId, number> {
  const out = {} as Record<HuntRegionId, number>;
  const known = HUNT_MAP_REGIONS.filter((r) => crops[r]).map((r) => [r, Math.hypot(crops[r].box[2] - crops[r].box[0], crops[r].box[3] - crops[r].box[1])] as const);
  const mean = known.reduce((s, [, d]) => s + d, 0) / Math.max(1, known.length);
  for (const r of HUNT_REGIONS) out[r] = known.find(([k]) => k === r)?.[1] ?? mean;
  return out;
}

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
  /** Its types, this form's ("dark" for Alolan Meowth): the type hint. */
  types: string[];
  /** The region of the games it was introduced in (a regional form's, that region), when it lives there: Easy deals these. */
  home?: HuntRegionId;
  /** The art: a PokéAPI Pokémon id for /api/art/<id> (the species' number for the base form, 10000+ for other forms). */
  art: number;
  /** The Pokédex page: /pokemon/<slug>#encounters. */
  slug: string;
  /** The regions it's found in, in HUNT_REGIONS order, no repeats. Equal to the set of its places' regions. */
  regions: HuntRegionId[];
  /** Every real spot (all on the map: rule 4). */
  places: HuntPlace[];
  /**
   * Measured difficulty, 0 (easy) – 1 (hard), on the world map with one pin:
   * 1 − the share of the map's land where a pin would score well against its nearest spot.
   */
  difficulty: number;
  /** Per region map: the same measure on that region's own map with one pin (only for regions it's found in). */
  regionDifficulty: Partial<Record<HuntMapRegionId, number>>;
  /** A famous Pokémon at a spot people know (Pikachu in Viridian Forest, Clefairy on Mt. Moon): Easy deals these. */
  famous?: boolean;
  /** Found nearly everywhere (no real "where"): never dealt on the world map, still fine in a region it's rare in. */
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
export const HUNT_MAX_ROUND_SCORE = 5000;
/** Every round is timed: PokéGuessr's 1:30. */
export const HUNT_TIMER_S = 90;
/** The first Daily Hunt (its number counts from here). */
export const HUNT_DAILY_FROM = "2026-11-23";

/**
 * How hard a free hunt is. Easy: famous Pokémon, each in its home region. Normal: the usual mix.
 * Hard: any Pokémon that can be dealt, on the world map, with no hints. The Daily is always Normal.
 */
export const HUNT_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type HuntDifficulty = (typeof HUNT_DIFFICULTIES)[number];
export const isHuntDifficulty = (v: unknown): v is HuntDifficulty => HUNT_DIFFICULTIES.includes(v as HuntDifficulty);

/**
 * The hints a round offers, in the order the card shows them, and what each costs: taken off the
 * round's points by the server (never below zero). Hard offers none.
 */
export const HUNT_HINTS = ["type", "place", "games"] as const;
export type HuntHintKind = (typeof HUNT_HINTS)[number];
export const isHuntHint = (v: unknown): v is HuntHintKind => HUNT_HINTS.includes(v as HuntHintKind);
export const HUNT_HINT_COSTS: Record<HuntHintKind, number> = { type: 500, place: 750, games: 1000 };
/** A round's points after its hints: what the pin earned, less every hint taken, never below zero. */
export const huntAfterHints = (points: number, hints: readonly HuntHintKind[]): number => Math.max(0, points - hints.reduce((s, h) => s + HUNT_HINT_COSTS[h], 0));

/** What kind of place a spot is, as the place hint names it. */
export type HuntPlaceKind = "grass" | "cave" | "water" | "open";
export const HUNT_PLACE_KINDS = ["grass", "cave", "water", "open"] as const satisfies readonly HuntPlaceKind[];
/** A method label's kind of place (scripts/hunt/rules.ts COUNTED_LABELS; "Wild", a wild spot with no method named, has none). */
export const HUNT_LABEL_KIND: Record<string, HuntPlaceKind> = {
  Grass: "grass",
  Cave: "cave",
  Surf: "water",
  "Old Rod": "water",
  "Good Rod": "water",
  "Super Rod": "water",
  Fishing: "water",
  Overworld: "open",
};

/** A hint as the server reveals it. */
export type HuntHint =
  | { kind: "type"; /** The type keys ("dark"), and their names in the page's language. */ types: string[]; names: string[] }
  | { kind: "place"; kinds: HuntPlaceKind[] }
  | { kind: "games"; /** Each game it's found in on this map, as the reveal labels games ("Diamond / Pearl"). */ games: string[] };

/** A game as the client asks for it. */
export interface HuntSpec {
  mode: HuntMode;
  /** Region mode: the map. */
  region?: HuntMapRegionId;
  /** Daily: the date (YYYY-MM-DD, UTC), set by the server. */
  daily?: string;
  /** Free hunts: Easy or Hard (Normal when left out). */
  difficulty?: Exclude<HuntDifficulty, "normal">;
  /** A Daily played again on this device: never ranked. */
  practice?: "repeat-daily";
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
  /** The hints this round offers (none on Hard). */
  hints: HuntHintKind[];
}

export interface HuntStartRequest {
  mode: HuntMode;
  region?: HuntMapRegionId;
  difficulty?: HuntDifficulty;
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
  difficulty: HuntDifficulty;
  /** A Daily played again on this device: it can't go on the board. */
  practice?: boolean;
  round: HuntRoundPublic;
}

/** A pin as the client sends it: the map's own 0–1 coordinates. */
export interface HuntPin {
  x: number;
  y: number;
}

export interface HuntGuessRequest {
  token: string;
  /** The pin: one (none when the clock ran out first). */
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

/** How the pin did: its nearest real spot, the distance to that spot's area, its points. */
export interface HuntPinResult {
  pin: HuntPin;
  /** The nearest spot's region (null: no pin, or off the map). */
  region: HuntRegionId | null;
  /** Index into HuntReveal.spots of the nearest spot. */
  spot: number | null;
  /** Map pixels to that spot's area (0 inside it; −1 for no pin). */
  distancePx: number;
  /** The same in town-map squares, as PokéGuessr says it (0 when spot on). */
  squares: number;
  /** What the pin earned, before hints. */
  score: number;
  /** The pin landed in that spot's region. */
  found: boolean;
}

export interface HuntReveal {
  id: string;
  name: string;
  /** Every real spot on the map played, grouped by region in HUNT_REGIONS order. */
  spots: HuntSpot[];
  regions: HuntRegionId[];
  /** The pin (empty when time ran out with none down). */
  pins: HuntPinResult[];
  /** The hints taken this round, and what they cost in all. */
  hints: HuntHintKind[];
  hintCost: number;
  fact: string;
  /** The Pokédex's "where to find" section: /pokemon/<slug>#encounters. */
  dex: string;
}

export interface HuntResultRound {
  id: string;
  name: string;
  art: string;
  score: number;
  /** Hints taken that round. */
  hints: number;
}

export interface HuntResult {
  sid: string;
  spec: HuntSpec;
  score: number;
  max: number;
  rounds: HuntResultRound[];
  durationMs: number;
  /** The Daily's signed result, for its leaderboard (a Daily played again carries none). */
  resultToken?: string;
}

/** The Daily's result as the server signs it for its leaderboard. */
export interface HuntDailyResult {
  sid: string;
  date: string;
  score: number;
  rounds: number[];
  durationMs: number;
  finishedAt: number;
}

/** A row of the Daily Hunt's board. */
export interface HuntBoardRow {
  rank: number;
  name: string;
  score: number;
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
