/** PokéGuessr types shared by the server and the client. */
import type { FamilyCombos, GeoEra, GeoFamilyId } from "./geo-families";

export const GEO_ROUNDS = 5;
/** Game lengths a solo player or a points-race duel can pick (the Daily is always GEO_ROUNDS). */
export const GEO_ROUND_OPTIONS = [3, 5, 10] as const;
export type GeoRounds = (typeof GEO_ROUND_OPTIONS)[number];
export const isGeoRounds = (n: unknown): n is GeoRounds => GEO_ROUND_OPTIONS.some((r) => r === n);
/** A spec's round count: GEO_ROUNDS unless it picked another length. */
export const geoRoundsOf = (spec: { rounds?: number }): number => (isGeoRounds(spec.rounds) ? spec.rounds : GEO_ROUNDS);
export const GEO_MAX_ROUND_SCORE = 5000;
/** A map with a game filter (an era, or picked games) needs this many places to play: fewer and the filter is off. */
export const GEO_FILTER_MIN_PLACES = 10;

/** game: five rounds scored by distance. streak: keep naming places until a pin misses. */
export const GEO_KINDS = ["game", "streak"] as const;
export type GeoKind = (typeof GEO_KINDS)[number];

/** The region played on the whole world map. */
export const WORLD_REGION = "world";
/** Maps in pickers: the whole world first, then the regions in release order, then the themed maps. */
export const GEO_MAP_ORDER = [
  WORLD_REGION,
  "kanto",
  "johto",
  "hoenn",
  "sinnoh",
  "unova",
  "kalos",
  "alola",
  "galar",
  "paldea",
  ...["gyms", "towns", "routes"].map((t) => `theme-${t}`),
];
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
  /** The game families it has screenshots of, in release order. */
  families: GeoFamilyId[];
  /** How many places have screenshots from exactly which families (for the game filters' counts). */
  combos: FamilyCombos;
  /** A preview screenshot (a starting town, so it gives nothing away). */
  preview: string | null;
  /** Themed maps: the whole world, played on one kind of place (see geo-themes.ts). */
  theme?: boolean;
}

export interface GeoSpec {
  region: string;
  kind: GeoKind;
  daily?: string;
  /** Games: 3, 5 or 10 rounds (unset = 5, as every score before this was). */
  rounds?: GeoRounds;
  /**
   * Not ranked: a repeat start of a daily, a friend's challenge (the places
   * are known), or a game on hand-picked game families (practice only).
   */
  practice?: "repeat-daily" | "challenge" | "filtered";
  /** Only Classic 2D or Modern 3D screenshots (all games when unset). */
  era?: GeoEra;
  /** Only these families (within the era): practice. */
  families?: GeoFamilyId[];
  /** "Guess the game too": name the screenshot's game family for bonus points each round. */
  guessGame?: boolean;
}

/** Leaderboard key for free play, e.g. "kanto", "kanto:streak" or "world:2d" (the eras have boards of their own). */
export const geoBoardKey = (spec: Pick<GeoSpec, "region" | "kind"> & { era?: GeoEra; rounds?: number }) =>
  `${spec.region}${spec.era ? `:${spec.era}` : ""}${spec.kind === "streak" ? ":streak" : ""}${
    spec.kind === "game" && geoRoundsOf(spec) !== GEO_ROUNDS ? `:r${geoRoundsOf(spec)}` : ""
  }`;

export interface GeoRoundPublic {
  index: number;
  shot: string;
  /** Look around: every view of the place this game can show, the dealt shot first (only when there's more than one). */
  views?: string[];
}

export interface GeoAnswer {
  name: string;
  /** The town or route a building/landmark sits in. */
  parent?: string;
  /** The screenshot's game (the specific version when known) and its family. */
  game: string;
  family: GeoFamilyId;
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
  /** Points for a game (distance only, as ranked), places in a row for a streak. */
  score: number;
  /** "Guess the game too": the bonus points on top (never part of the ranked score). */
  bonus?: number;
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

/** "Guess the game too": what the player named and what it earned. */
export interface GeoGameGuess {
  guessed: GeoFamilyId | null;
  correct: boolean;
  bonus: number;
}

export interface GeoGuessResponse {
  score: number;
  /** The round's clock ran out with no pin down (the Timer setting): no points. */
  timedOut?: boolean;
  gameGuess?: GeoGameGuess;
  /** "Guess the game too": the bonus so far. */
  bonusTotal?: number;
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
