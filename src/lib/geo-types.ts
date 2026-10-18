/** PokéGuessr types shared by the server and the client. */

export const GEO_ROUNDS = 5;
export const GEO_MAX_ROUND_SCORE = 5000;

/** game: five rounds scored by distance. streak: keep naming places until a pin misses. */
export const GEO_KINDS = ["game", "streak"] as const;
export type GeoKind = (typeof GEO_KINDS)[number];

/** The region played on the whole world map. */
export const WORLD_REGION = "world";
/** Maps in pickers: the whole world first, then the regions in release order. */
export const GEO_MAP_ORDER = [WORLD_REGION, "kanto", "johto", "hoenn", "sinnoh", "unova", "kalos", "alola", "galar", "paldea"];
export const geoMapRank = (id: string) => (GEO_MAP_ORDER.includes(id) ? GEO_MAP_ORDER.indexOf(id) : GEO_MAP_ORDER.length);
/** The daily game is played on the world map from this date (Kanto before it). */
export const WORLD_DAILY_FROM = "2026-10-18";
/** The region a day's daily game is played in. */
export const geoDailyRegion = (date: string, worldPlayable: boolean) => (worldPlayable && date >= WORLD_DAILY_FROM ? WORLD_REGION : "kanto");

export interface GeoRegionInfo {
  id: string;
  name: string;
  /**
   * Every map is the world atlas: the whole of it, or one region's part of it.
   * `box` is that part in world-map pixels (pins and guesses are normalised to it);
   * `src` is a picture of it for previews.
   */
  map: { src: string; box: [number, number, number, number] };
  /** Playable places (a town and its buildings count once). */
  locations: number;
  /** Games the screenshots come from, from Red / Blue to the latest remakes. */
  games: string[];
  /** A preview screenshot (a starting town, so it gives nothing away). */
  preview: string | null;
}

export interface GeoSpec {
  region: string;
  kind: GeoKind;
  daily?: string;
  /** Not ranked: a repeat start of a daily, or a friend's challenge (the places are known). */
  practice?: "repeat-daily" | "challenge";
}

/** Leaderboard key for free play, e.g. "kanto" or "kanto:streak". */
export const geoBoardKey = (spec: Pick<GeoSpec, "region" | "kind">) => `${spec.region}${spec.kind === "streak" ? ":streak" : ""}`;

export interface GeoRoundPublic {
  index: number;
  shot: string;
}

export interface GeoAnswer {
  name: string;
  /** The town or route a building/landmark sits in. */
  parent?: string;
  game: string;
  pin: [number, number];
  mask: [number, number][];
  /** Distance from the guess to the location, in town-map squares (0 = inside it). */
  squares: number;
  /** World games: the region the place is in. */
  region?: string;
}

/** A friend's finished game, carried in a challenge link. */
export interface GeoChallenge {
  name: string;
  score: number;
  rounds: number[];
}

export interface GeoResult {
  sid: string;
  spec: GeoSpec;
  /** Points for a game, places in a row for a streak. */
  score: number;
  rounds: { score: number; name: string }[];
  durationMs: number;
  finishedAt: number;
}

export interface GeoStartResponse {
  token: string;
  /** The region being played (the daily picks its own). */
  region: string;
  round: GeoRoundPublic;
  practice?: GeoSpec["practice"];
}

export interface GeoGuessResponse {
  score: number;
  /** Streak mode: the pin landed on the place (on the world map: in the right region). */
  hit: boolean;
  answer: GeoAnswer;
  token: string;
  total: number;
  next?: GeoRoundPublic;
  done: boolean;
  result?: GeoResult;
  resultToken?: string;
  /** Standard games: a link token so friends can play the same five places. */
  challengeToken?: string;
}
