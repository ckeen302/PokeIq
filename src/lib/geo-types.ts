/** PokéGuessr types shared by the server and the client. */

export const GEO_ROUNDS = 5;
export const GEO_MAX_ROUND_SCORE = 5000;

/**
 * classic: 3D ground-level views from Let's Go, Pikachu! / Eevee! (the GeoGuessr feel).
 * retro:   top-down layouts of the whole area from the Game Boy / GBA / DS games.
 */
export const GEO_STYLES = ["classic", "retro"] as const;
export type GeoStyle = (typeof GEO_STYLES)[number];

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
  daily?: string;
  /** Repeat starts of a daily are playable but not ranked. */
  practice?: "repeat-daily";
}

/** Leaderboard key for free play, e.g. "kanto:classic". */
export const geoBoardKey = (spec: Pick<GeoSpec, "region" | "style">) => `${spec.region}:${spec.style}`;

export interface GeoRoundPublic {
  index: number;
  shot: string;
}

export interface GeoAnswer {
  name: string;
  game: string;
  pin: [number, number];
  mask: [number, number][];
}

export interface GeoResult {
  sid: string;
  spec: GeoSpec;
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
  answer: GeoAnswer;
  token: string;
  total: number;
  next?: GeoRoundPublic;
  done: boolean;
  result?: GeoResult;
  resultToken?: string;
}
