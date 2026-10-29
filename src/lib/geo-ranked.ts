/**
 * Ranked PokéGuessr duels, client safe: the divisions, the rating rules
 * (Showdown's Elo, lib/rating/elo.ts, with a shock absorber for a small
 * ladder), the Gym Leader bot's roster and aim, and the types the API and
 * the duel view share. The server (lib/server/geo-ranked.ts) applies every
 * rating change; the client draws the badges.
 *
 * Only head-to-head HP duels matched in the ranked queue are rated: solo
 * games, the Daily and duels with a friend never touch a rating.
 */

import { ELO_FLOOR, ELO_START, eloDecayDays, eloExpected, eloK } from "./rating/elo";
import { WORLD_REGION } from "./geo-types";
import type { GeoSeasonView } from "./geo-seasons";

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

/**
 * The divisions, lowest first, each from its Elo up to the next one's. The
 * raw number is hidden in the two lowest (the division alone is shown) and
 * shown from Ultra Ball up. Tune the thresholds here and nowhere else.
 */
export const GEO_DIVISIONS = [
  { id: "poke", name: "Poké Ball", from: 1000, showElo: false },
  { id: "great", name: "Great Ball", from: 1100, showElo: false },
  { id: "ultra", name: "Ultra Ball", from: 1200, showElo: true },
  { id: "master", name: "Master Ball", from: 1350, showElo: true },
  { id: "beast", name: "Beast Ball", from: 1500, showElo: true },
] as const;
export type GeoDivisionId = (typeof GEO_DIVISIONS)[number]["id"];

/** The top division's bar fills over this many points above its floor. */
const TOP_SPAN = 200;

export interface GeoDivision {
  id: GeoDivisionId;
  name: string;
  /** 0 for Poké Ball, up to 4 for Beast Ball: compare two to spot a promotion. */
  index: number;
  from: number;
  /** Where the next division starts, or null at the top. */
  to: number | null;
  /** How far through the division (0 to 1). */
  progress: number;
  /** Whether the raw Elo is shown beside the badge. */
  showElo: boolean;
  /** The next division's name, or null at the top. */
  next: string | null;
}

/** The division an Elo sits in, and how far it is to the next. */
export function geoDivisionOf(elo: number): GeoDivision {
  let index = 0;
  for (let i = 0; i < GEO_DIVISIONS.length; i++) if (elo >= GEO_DIVISIONS[i].from) index = i;
  const d = GEO_DIVISIONS[index];
  const above = GEO_DIVISIONS[index + 1];
  const to = above ? above.from : null;
  const span = to === null ? TOP_SPAN : to - d.from;
  return {
    id: d.id,
    name: d.name,
    index,
    from: d.from,
    to,
    progress: Math.max(0, Math.min(1, (elo - d.from) / span)),
    showElo: d.showElo,
    next: above ? above.name : null,
  };
}

/** The Elo a division starts at (the Gym Leader bot plays at the trainer's division floor). */
export const geoDivisionFloor = (id: GeoDivisionId) => GEO_DIVISIONS.find((d) => d.id === id)!.from;

/**
 * Not built yet: weekly groups and promotion cells, GeoGuessr style, for
 * when the ladder has the traffic for them (5,000+ daily players). The
 * divisions above stay the visual tiers; this is where their schedule
 * would live. Nothing reads it.
 */
export const GEO_RANKED_GROUPS_PHASE = {
  enabled: false,
  /** Trainers per weekly group, once there are enough of them. */
  groupSize: 50,
  /** The share of a group promoted and demoted when the week ends. */
  promote: 0.2,
  demote: 0.2,
  /** Daily active trainers the ladder needs before groups make sense. */
  minimumDailyPlayers: 5000,
} as const;

// ---------------------------------------------------------------------------
// Rating rules
// ---------------------------------------------------------------------------

export const GEO_ELO_START = ELO_START;
export const GEO_ELO_FLOOR = ELO_FLOOR;

/** A rating gap wider than this (0 disables) softens both trainers' K by SHOCK_K_SCALE: a mismatch on a quiet ladder isn't a verdict. */
export const GEO_RANKED_SHOCK_DIFF_DEFAULT = 350;
export const GEO_RANKED_SHOCK_K_SCALE = 12 / 32;
/** A duel against the Gym Leader bot moves a rating at half the K. */
export const GEO_RANKED_BOT_K_SCALE = 0.5;

export interface GeoRatingRules {
  /** The gap that triggers the shock absorber; 0 disables it. */
  shockDiff: number;
  /** A further scale on K (the bot's half). */
  kScale?: number;
}

export interface GeoRatingChange {
  before: number;
  after: number;
  delta: number;
}

/** Each seat's score (1 win, ½ draw, 0 loss). A duel nobody won is a draw. */
export function geoMatchScores(winner: number | null): [number, number] {
  if (winner === 0) return [1, 0];
  if (winner === 1) return [0, 1];
  return [0.5, 0.5];
}

/** `me`'s new Elo (whole points) after scoring `score` against `foe` under the rules. */
export function geoEloUpdate(me: number, foe: number, score: number, rules: GeoRatingRules): number {
  const shock = rules.shockDiff > 0 && Math.abs(me - foe) > rules.shockDiff ? GEO_RANKED_SHOCK_K_SCALE : 1;
  const k = eloK(me, score) * shock * (rules.kScale ?? 1);
  return Math.max(GEO_ELO_FLOOR, Math.round(me + k * (score - eloExpected(me, foe))));
}

/** Both seats' ratings after a duel. */
export function geoRateDuel(elos: readonly [number, number], scores: readonly [number, number], rules: GeoRatingRules): [GeoRatingChange, GeoRatingChange] {
  const change = (me: number, foe: number, score: number): GeoRatingChange => {
    const after = geoEloUpdate(me, foe, score, rules);
    return { before: me, after, delta: after - me };
  };
  return [change(elos[0], elos[1], scores[0]), change(elos[1], elos[0], scores[1])];
}

// ---------------------------------------------------------------------------
// Decay, lazily
// ---------------------------------------------------------------------------

/** "2026-10-27": the UTC day a moment falls in. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole days from one UTC day to another (0 when `to` isn't after `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

/** What a rating's decay needs: the Elo, the last day it was counted on, and that day's games. */
export interface GeoDecayState {
  elo: number;
  /** The UTC day of the last game (null before the first). */
  day: string | null;
  gamesToday: number;
}

/**
 * The rating as it stands on `today`: every day since `day` decayed (that
 * day with its games, the ones after it with none). Idempotent: once the
 * row is brought to `today`, reading it again changes nothing.
 */
export function geoDecayedElo(state: GeoDecayState, today: string): number {
  if (!state.day) return state.elo;
  return eloDecayDays(state.elo, daysBetween(state.day, today), [state.gamesToday]);
}

// ---------------------------------------------------------------------------
// Matchmaking
// ---------------------------------------------------------------------------

/** Ranked is one queue: head-to-head HP duels on the world map, every game. */
export const GEO_RANKED_REGION = WORLD_REGION;
export const GEO_RANKED_MATCH = { game: "geo", region: GEO_RANKED_REGION, ranked: true } as const;
export const GEO_RANKED_QUEUE_KEY = "geo:ranked";

/** How far apart two Elos may be after waiting this long: close duels first, then anyone. Checked from both trainers' sides. */
export const GEO_RANKED_BRACKETS: readonly { underS: number; diff: number }[] = [
  { underS: 15, diff: 50 },
  { underS: 30, diff: 150 },
  { underS: 45, diff: 300 },
];

/** The gap allowed for a trainer who has waited `ms` (Infinity once every bracket has passed; `maxDiff` caps it, 0 for no cap). */
export function geoAllowedDiff(ms: number, maxDiff = 0): number {
  const s = Math.max(0, ms) / 1000;
  const bracket = GEO_RANKED_BRACKETS.find((b) => s < b.underS);
  const diff = bracket ? bracket.diff : Infinity;
  return maxDiff > 0 ? Math.min(diff, maxDiff) : diff;
}

/** Whether two trainers may be paired: the gap must fit what each one's own wait allows. */
export function geoPairable(gap: number, waits: readonly [number, number], maxDiff = 0): boolean {
  return waits.every((w) => gap <= geoAllowedDiff(w, maxDiff));
}

/** Seconds a ranked seeker waits before the Gym Leader is offered (0 disables the bot). */
export const GEO_RANKED_BOT_AFTER_S_DEFAULT = 90;

// ---------------------------------------------------------------------------
// The Gym Leader bot
// ---------------------------------------------------------------------------

/** What the bot is called in a duel: never a plain trainer name. */
export const GEO_BOT_TITLE = "Gym Leader";
export const GEO_BOT_NAME_RE = /^Gym Leader /;

/** The Gym Leaders the bot plays as, with their specialty type for the trainer-class avatar. */
export const GEO_GYM_LEADERS: readonly { name: string; type: string }[] = [
  { name: "Brock", type: "Rock" },
  { name: "Misty", type: "Water" },
  { name: "Lt. Surge", type: "Electric" },
  { name: "Erika", type: "Grass" },
  { name: "Koga", type: "Poison" },
  { name: "Sabrina", type: "Psychic" },
  { name: "Blaine", type: "Fire" },
  { name: "Falkner", type: "Flying" },
  { name: "Bugsy", type: "Bug" },
  { name: "Whitney", type: "Normal" },
  { name: "Morty", type: "Ghost" },
  { name: "Chuck", type: "Fighting" },
  { name: "Jasmine", type: "Steel" },
  { name: "Pryce", type: "Ice" },
  { name: "Clair", type: "Dragon" },
  { name: "Roxanne", type: "Rock" },
];

/** "Gym Leader Brock". */
export const geoBotName = (leader: string) => `${GEO_BOT_TITLE} ${leader}`;

/** The Gym Leader behind a bot's name, or null for a human. */
export function gymLeaderOf(name: string): { name: string; type: string } | null {
  if (!GEO_BOT_NAME_RE.test(name)) return null;
  const leader = name.replace(GEO_BOT_NAME_RE, "");
  return GEO_GYM_LEADERS.find((g) => g.name === leader) ?? { name: leader, type: "Normal" };
}

/**
 * How well the bot aims, per division: the standard deviation of its pin's
 * miss along each axis, as a fraction of the map's diagonal. Scores fall off
 * as 5000·e^(−10·d/diagonal), so (simulated over a 2D Gaussian miss) these
 * average about 2,000 a round in Poké Ball (a first-timer), 2,500 in Great,
 * 3,100 in Ultra, 3,500 in Master and 3,900+ in Beast Ball (a strong human,
 * with the perfect-pin radius adding a little on top).
 */
export const GEO_BOT_SIGMA: Record<GeoDivisionId, number> = {
  poke: 0.085,
  great: 0.06,
  ultra: 0.042,
  master: 0.03,
  beast: 0.02,
};

/** The bot takes this long to guess (from the round's start), scaled down a little per division; after the trainer guesses, this long to react. */
export const GEO_BOT_DELAY_MS: readonly [number, number] = [8_000, 20_000];
export const GEO_BOT_REACT_MS: readonly [number, number] = [3_000, 10_000];

/** A standard normal from two uniforms (Box–Muller). */
export function gaussian(u1: number, u2: number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(2 * Math.PI * u2);
}

/**
 * The bot's pin for a round: the place's pin plus a Gaussian miss with
 * `sigma` (a fraction of the map's diagonal) along each axis, clamped to the
 * map. `rand` supplies uniforms (a seeded RNG, so a duel is reproducible).
 */
export function botPin(target: readonly [number, number], map: { width: number; height: number }, sigma: number, rand: () => number): { x: number; y: number } {
  const px = sigma * Math.hypot(map.width, map.height);
  const dx = (gaussian(rand(), rand()) * px) / map.width;
  const dy = (gaussian(rand(), rand()) * px) / map.height;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(target[0] + dx), y: clamp(target[1] + dy) };
}

// ---------------------------------------------------------------------------
// What the API and the duel view carry
// ---------------------------------------------------------------------------

/** A ranked trainer's standing, as /api/geo/ranked returns it. */
export interface GeoRankedStanding {
  elo: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** The most points scored over the rounds of one ranked duel. */
  bestScore: number;
  /** Place on the ladder (1 is the top), or null before a first game. */
  position: number | null;
  /** Ranked trainers in all (never the bot). */
  players: number;
}

export interface GeoRankedLeaderRow {
  position: number;
  name: string;
  /** Null where the division hides it (Poké and Great Ball). */
  elo: number | null;
  division: GeoDivisionId;
  games: number;
  wins: number;
  losses: number;
}

export type GeoRankedResponse =
  | { available: false; id?: string }
  | {
      available: true;
      id?: string;
      you: GeoRankedStanding | null;
      top?: GeoRankedLeaderRow[];
      /** The Gym Leader is offered after this many seconds in the queue (0: never). */
      botAfterS: number;
      /** The season running now (null before the first), with your season so far and your finished seasons where they're stored. */
      season?: GeoSeasonView | null;
    };

/** A ranked duel as its trainers see it: each seat's Elo going in and, once counted, before and after. Seat 1 may be the bot. */
export interface GeoDuelRankedView {
  elos: [number, number];
  bot: boolean;
  result?: { before: [number, number]; after: [number, number] };
}
