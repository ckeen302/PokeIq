/**
 * PokéGuessr's screenshot audit: quality flags and a difficulty rating per
 * shot (src/data/geo-shot-meta.json, written by scripts/geo/audit-shots.ts).
 * Flagged shots are never removed: they're just dealt less often. Difficulty
 * starts as a heuristic and moves to players' real scores once a shot has
 * enough logged rounds.
 */
import type { GeoFamilyId } from "./geo-families";

export const SHOT_FLAG = { small: 1, blurry: 2, ui: 4, tall: 8 } as const;
export type ShotFlag = keyof typeof SHOT_FLAG;

/** [width, height, flags, difficulty × 10] */
export type ShotMetaRow = [number, number, number, number];
export interface ShotMetaFile {
  v: 1;
  shots: Record<string, ShotMetaRow>;
}

export const GEO_DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type GeoDifficulty = (typeof GEO_DIFFICULTIES)[number];
export const GEO_DIFFICULTY_NAMES: Record<GeoDifficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
export const GEO_DIFFICULTY_BLURBS: Record<GeoDifficulty, string> = {
  easy: "Towns, landmarks and clear views.",
  normal: "Every place, as it comes.",
  hard: "Routes, caves, interiors and tricky views.",
};

/** A flagged shot is dealt this much as often as a clean one (never zero: nothing is removed). */
export const FLAGGED_WEIGHT = 0.25;
/** Unrated shots sit in the middle. */
export const DEFAULT_DIFFICULTY = 3;
/** Logged rounds a shot needs before players' scores replace the heuristic. */
export const MIN_SCORED_ROUNDS = 8;

export const flagNames = (flags: number): ShotFlag[] => (Object.keys(SHOT_FLAG) as ShotFlag[]).filter((k) => flags & SHOT_FLAG[k]);

const EASY_NAME = /\b(City|Town|Village|Pokémon League|Gym|Stadium|Tower|Academy|Island)\b/i;
const HARD_NAME = /\b(Cave|Tunnel|Cavern|Forest|Woods|Grotto|Ruins|Chamber|Mine|Den|Path|Road|Mountain|Mt\.|Underground|Hollow|Lake|Sea|Bay|Trench|Route)\b/i;
const OLD = new Set<GeoFamilyId>(["rby", "gsc"]);
const MODERN = new Set<GeoFamilyId>(["lgpe", "swsh", "bdsp", "sv"]);

/**
 * 1 (easy) to 5 (hard), from what a player can go on: towns and famous places
 * are easier than routes, caves and rooms inside buildings; the oldest sprite
 * games and soft, flat or tiny pictures are harder; places with many shots are
 * usually the well-known ones.
 */
export function heuristicDifficulty(s: {
  name: string;
  parent?: string;
  family: GeoFamilyId;
  flags: number;
  detail: number;
  placeShots: number;
}): number {
  let d = 2.8;
  if (s.parent) d += 0.7;
  if (EASY_NAME.test(s.name) && !s.parent) d -= 0.6;
  if (HARD_NAME.test(s.name)) d += 0.5;
  if (OLD.has(s.family)) d += 0.4;
  if (MODERN.has(s.family)) d -= 0.2;
  if (s.flags & (SHOT_FLAG.blurry | SHOT_FLAG.small)) d += 0.3;
  if (s.flags & SHOT_FLAG.ui) d += 0.5;
  if (s.detail < 10) d += 0.2;
  if (s.placeShots >= 10) d -= 0.4;
  else if (s.placeShots <= 2) d += 0.3;
  return Math.max(1, Math.min(5, Math.round(d * 10) / 10));
}

/**
 * Players' rounds turned into a difficulty: an average of 5,000 points is a
 * 1, an average near 0 a 5. Blended with the heuristic until there are plenty.
 */
export function scoredDifficulty(heuristic: number, avgScore: number, rounds: number): number {
  if (rounds < MIN_SCORED_ROUNDS) return heuristic;
  const fromPlayers = 1 + 4 * (1 - Math.max(0, Math.min(5000, avgScore)) / 5000);
  const w = Math.min(1, rounds / (MIN_SCORED_ROUNDS * 4));
  return Math.round((heuristic * (1 - w) + fromPlayers * w) * 10) / 10;
}

/** How likely a shot is to be dealt in a mode: low-quality shots less, and each mode leaning its own way. */
export function shotWeight(difficulty: number, flags: number, mode: GeoDifficulty = "normal"): number {
  const quality = flags ? FLAGGED_WEIGHT : 1;
  const lean = mode === "easy" ? (6 - difficulty) ** 2 : mode === "hard" ? difficulty ** 2 : 1;
  return quality * lean;
}

/** Whether a shot fits a mode outright (an area needs one to be dealt in Easy or Hard, when the map has enough). */
export const fitsMode = (difficulty: number, mode: GeoDifficulty) => (mode === "easy" ? difficulty <= 2.8 : mode === "hard" ? difficulty >= 3.2 : true);

/** The Daily's five rounds, easiest first. */
export const rampOrder = <T extends { difficulty: number }>(rounds: T[]): T[] => [...rounds].sort((a, b) => a.difficulty - b.difficulty);
