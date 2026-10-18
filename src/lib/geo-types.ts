/** PokéGuessr types shared by the server and the client. */

export const GEO_ROUNDS = 5;
export const GEO_MAX_ROUND_SCORE = 5000;

/**
 * classic: 3D ground-level views from Let's Go, Pikachu! / Eevee! (the GeoGuessr feel).
 * retro:   top-down layouts and screenshots from the Game Boy / GBA / DS games.
 */
export const GEO_STYLES = ["classic", "retro"] as const;
export type GeoStyle = (typeof GEO_STYLES)[number];

/** game: five rounds scored by distance. streak: keep naming places until a pin misses. */
export const GEO_KINDS = ["game", "streak"] as const;
export type GeoKind = (typeof GEO_KINDS)[number];

export interface GeoRegionInfo {
  id: string;
  name: string;
  map: { src: string; width: number; height: number };
  /** Playable locations per style. */
  locations: Record<GeoStyle, number>;
  /** A preview screenshot per style (Pallet Town, so it gives nothing away). */
  previews: Record<GeoStyle, string | null>;
}

export interface GeoSpec {
  region: string;
  style: GeoStyle;
  kind: GeoKind;
  daily?: string;
  /** Not ranked: a repeat start of a daily, or a friend's challenge (the places are known). */
  practice?: "repeat-daily" | "challenge";
}

/** Leaderboard key for free play, e.g. "kanto:classic" or "kanto:classic:streak". */
export const geoBoardKey = (spec: Pick<GeoSpec, "region" | "style" | "kind">) =>
  `${spec.region}:${spec.style}${spec.kind === "streak" ? ":streak" : ""}`;

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
}

/** A friend's finished game, carried in a challenge link. */
export interface GeoChallenge {
  name: string;
  score: number;
  rounds: number[];
  style: GeoStyle;
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
  round: GeoRoundPublic;
  practice?: GeoSpec["practice"];
}

export interface GeoGuessResponse {
  score: number;
  /** Streak mode: the pin landed on the place. */
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
