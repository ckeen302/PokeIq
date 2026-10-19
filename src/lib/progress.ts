"use client";

import { useSyncExternalStore } from "react";
import { previousDate } from "./daily";
import type { DleHint } from "./dle-types";
import { updatePlayerRating } from "./rating";
import type { RunResult } from "./session-types";

/**
 * Local-first player progress: XP, levels, daily streaks, PokéIQ rating and
 * badges, persisted in localStorage — no signup needed to get hooked. Runs
 * are only recorded from server-graded results.
 */

export interface DailyRecord {
  score: number;
  correct: number;
  total: number;
  grid: string;
  pokeiq: number;
  shareToken?: string;
}

export interface DleRecord {
  guesses: number[];
  solved: boolean;
  over: boolean;
  /** Played in hard mode (every guess fit the clues before it). */
  hard?: boolean;
  /** The hints used, which cost points. */
  hints?: DleHint[];
}

export interface Progress {
  v: 1;
  name: string;
  xp: number;
  rating: number | null;
  runs: number;
  answered: number;
  correct: number;
  bestStreak: number;
  best: Record<string, number>;
  modulesPlayed: string[];
  daily: { last: string | null; streak: number; best: number; results: Record<string, DailyRecord> };
  dle: { last: string | null; streak: number; best: number; results: Record<string, DleRecord> };
  badges: Record<string, number>;
  /** Per-skill tallies for the coach: tag -> [correct, answered]. */
  skills: Record<string, [number, number]>;
}

const KEY = "pokeiq:progress:v1";

const EMPTY: Progress = {
  v: 1,
  name: "",
  xp: 0,
  rating: null,
  runs: 0,
  answered: 0,
  correct: 0,
  bestStreak: 0,
  best: {},
  modulesPlayed: [],
  daily: { last: null, streak: 0, best: 0, results: {} },
  dle: { last: null, streak: 0, best: 0, results: {} },
  badges: {},
  skills: {},
};

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

export const BADGES: BadgeDef[] = [
  { id: "first-run", name: "New Trainer", description: "Finish your first run", emoji: "🎒" },
  { id: "certified", name: "Certified", description: "Complete the adaptive PokéIQ Test", emoji: "📜" },
  { id: "perfect", name: "Flawless", description: "Go 10/10 in a Classic run", emoji: "💎" },
  { id: "streak-10", name: "On Fire", description: "Answer 10 in a row", emoji: "🔥" },
  { id: "survivor", name: "Survivor", description: "Get 25 right in one Survival run", emoji: "🛡️" },
  { id: "blitz", name: "Quick Claw", description: "Get 20 right in one Blitz", emoji: "⚡" },
  { id: "purist", name: "Kanto Purist", description: "Perfect Gen 1-only Classic run", emoji: "🗾" },
  { id: "iq-120", name: "Gym Leader Brain", description: "Score a PokéIQ of 120+", emoji: "🧠" },
  { id: "iq-140", name: "Professor", description: "Score a PokéIQ of 140+", emoji: "🎓" },
  { id: "all-modes", name: "Completionist", description: "Play every game mode", emoji: "🗺️" },
  { id: "daily-3", name: "Regular", description: "3-day Daily Challenge streak", emoji: "📅" },
  { id: "daily-7", name: "Dedicated", description: "7-day Daily Challenge streak", emoji: "🏅" },
  { id: "daily-30", name: "Legend", description: "30-day Daily Challenge streak", emoji: "👑" },
  { id: "dle-3", name: "Detective", description: "Solve a Pokédle in 3 guesses or fewer", emoji: "🔍" },
  { id: "dle-1", name: "Psychic", description: "Solve a Pokédle in one guess", emoji: "🔮" },
  { id: "geo-first", name: "Explorer", description: "Finish a PokéGuessr game", emoji: "🧭" },
  { id: "geo-pinpoint", name: "Pinpoint", description: "Score 5,000 in a PokéGuessr round", emoji: "📍" },
  { id: "geo-20k", name: "Cartographer", description: "Score 20,000+ in a PokéGuessr game", emoji: "🗺️" },
  { id: "geo-streak-10", name: "Pathfinder", description: "Name 10 places in a row in PokéGuessr Streak", emoji: "🥾" },
];

const PLAYABLE_MODES = ["whos-that", "cry", "dex", "types", "higher-lower"];

// ---------------------------------------------------------------------------
// Store (useSyncExternalStore over localStorage)
// ---------------------------------------------------------------------------

let cache: Progress | null = null;
const listeners = new Set<() => void>();

function read(): Progress {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Progress) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: Progress) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota: progress just won't persist.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Replaces the whole record — used when syncing with a trainer account. */
export function replaceProgress(next: Progress) {
  write(next);
}

/** Wipes this device's copy (on sign-out the account keeps the progress). */
export function resetProgress() {
  write(EMPTY);
}

/** Notifies on every local change, for pushing progress to the account. */
export function onProgressChange(listener: (p: Progress) => void): () => void {
  const wrapped = () => listener(read());
  listeners.add(wrapped);
  return () => listeners.delete(wrapped);
}

/** Returns null during SSR / before hydration so pages render deterministically. */
export function useProgress(): Progress | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function getProgress(): Progress {
  return read();
}

export function setTrainerName(name: string) {
  write({ ...read(), name: name.trim().slice(0, 24) });
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Level n needs 50·n² XP in total — quick early levels, a long tail. */
export function levelInfo(xp: number) {
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const floor = 50 * (level - 1) ** 2;
  const ceil = 50 * level ** 2;
  return { level, progress: (xp - floor) / (ceil - floor), toNext: ceil - xp };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface RunReward {
  xp: number;
  levelBefore: number;
  levelAfter: number;
  newBadges: BadgeDef[];
  dailyStreak?: number;
  ratingBefore: number | null;
  ratingAfter: number;
}

/**
 * The streak as of `today`: it is still alive if the last completion was
 * today or yesterday, and broken (0) otherwise. Stored streaks only update
 * when the next puzzle is finished, so every display must go through this.
 */
export function currentStreak(last: string | null, streak: number, today: string): number {
  if (!last) return 0;
  return last === today || last === previousDate(today) ? streak : 0;
}

function streakAfter(last: string | null, streak: number, date: string): number {
  if (last === date) return streak;
  return last === previousDate(date) ? streak + 1 : 1;
}

function award(p: Progress, ids: string[], now: number): BadgeDef[] {
  const fresh: BadgeDef[] = [];
  for (const id of ids) {
    if (!p.badges[id]) {
      p.badges[id] = now;
      const def = BADGES.find((b) => b.id === id);
      if (def) fresh.push(def);
    }
  }
  return fresh;
}

export function recordRun(result: RunResult, shareToken?: string): RunReward {
  const before = read();
  const p: Progress = structuredClone(before);
  const now = Date.now();
  const { spec } = result;

  // The daily bonus is paid once per date, even if the daily is replayed in another tab.
  const firstDaily = !!spec.daily && !p.daily.results[spec.daily];
  const xp = result.correct * 10 + Math.round(result.score / 50) + (firstDaily ? 50 : 0);
  p.xp += xp;
  p.runs += 1;
  p.answered += result.total;
  p.correct += result.correct;
  p.bestStreak = Math.max(p.bestStreak, result.bestStreak);
  const bestKey = `${spec.module}:${spec.format}`;
  p.best[bestKey] = Math.max(p.best[bestKey] ?? 0, result.score);
  if (!p.modulesPlayed.includes(spec.module)) p.modulesPlayed.push(spec.module);
  // The adaptive test is the most precise measurement we have: weight it more.
  p.rating = updatePlayerRating(before.rating, result.rating, spec.format === "adaptive" ? result.total * 1.5 : result.total);

  if (spec.daily && firstDaily) {
    p.daily.streak = streakAfter(p.daily.last, p.daily.streak, spec.daily);
    p.daily.best = Math.max(p.daily.best, p.daily.streak);
    p.daily.last = spec.daily;
    p.daily.results[spec.daily] = {
      score: result.score,
      correct: result.correct,
      total: result.total,
      grid: result.grid,
      pokeiq: result.pokeiq,
      shareToken,
    };
  }

  const earned = ["first-run"];
  if (spec.format === "classic" && result.correct === result.total && result.total >= 10) earned.push("perfect");
  if (result.bestStreak >= 10) earned.push("streak-10");
  if (spec.format === "survival" && result.correct >= 25) earned.push("survivor");
  if (spec.format === "blitz" && result.correct >= 20) earned.push("blitz");
  if (spec.format === "classic" && spec.gens?.length === 1 && spec.gens[0] === 1 && result.correct === result.total)
    earned.push("purist");
  if (spec.format === "adaptive") earned.push("certified");
  if (result.pokeiq >= 120) earned.push("iq-120");
  if (result.pokeiq >= 140) earned.push("iq-140");
  if (PLAYABLE_MODES.every((m) => p.modulesPlayed.includes(m))) earned.push("all-modes");
  if (p.daily.streak >= 3) earned.push("daily-3");
  if (p.daily.streak >= 7) earned.push("daily-7");
  if (p.daily.streak >= 30) earned.push("daily-30");
  const newBadges = award(p, earned, now);

  write(p);
  return {
    xp,
    levelBefore: levelInfo(before.xp).level,
    levelAfter: levelInfo(p.xp).level,
    newBadges,
    dailyStreak: spec.daily ? p.daily.streak : undefined,
    ratingBefore: before.rating,
    ratingAfter: p.rating,
  };
}

function geoDailyLast(p: Progress): string | null {
  const n = p.best["geo:dailyLast"];
  if (!n) return null;
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** PokéGuessr daily streak as of `today` (0 once a day is missed). */
export function geoDailyStreak(p: Progress, today: string): number {
  return currentStreak(geoDailyLast(p), p.best["geo:dailyStreak"] ?? 0, today);
}

/** A finished PokéGuessr game or streak: XP, per-mode best, daily record and badges. */
export function recordGeoGame(
  board: string,
  game: { kind: "game" | "streak"; score: number; rounds: number[]; daily?: string }
): { xp: number; best: boolean; newBadges: BadgeDef[] } {
  const p: Progress = structuredClone(read());
  const key = game.daily ? "geo:daily" : `geo:${board}`;
  const dailyKey = game.daily ? `geo-daily:${game.daily}` : null;
  // Like the other dailies, only the first game of the day earns XP.
  const xp = dailyKey && p.best[dailyKey] !== undefined ? 0 : game.kind === "streak" ? game.score * 10 : Math.round(game.score / 250);
  const best = game.score > (p.best[key] ?? 0);
  p.xp += xp;
  p.best[key] = Math.max(p.best[key] ?? 0, game.score);
  p.best["geo:games"] = (p.best["geo:games"] ?? 0) + 1;
  if (dailyKey && game.daily && p.best[dailyKey] === undefined) {
    p.best[dailyKey] = game.score;
    // Daily streak, kept in the numeric `best` map: the last date as YYYYMMDD.
    const last = geoDailyLast(p);
    const streak = streakAfter(last, p.best["geo:dailyStreak"] ?? 0, game.daily);
    p.best["geo:dailyStreak"] = streak;
    p.best["geo:dailyBest"] = Math.max(p.best["geo:dailyBest"] ?? 0, streak);
    p.best["geo:dailyLast"] = Number(game.daily.replaceAll("-", ""));
  }
  if (!p.modulesPlayed.includes("geo")) p.modulesPlayed.push("geo");

  const earned = ["geo-first"];
  if (game.kind === "game" && game.rounds.some((r) => r >= 5000)) earned.push("geo-pinpoint");
  if (game.kind === "game" && game.score >= 20000) earned.push("geo-20k");
  if (game.kind === "streak" && game.score >= 10) earned.push("geo-streak-10");
  const newBadges = award(p, earned, Date.now());
  write(p);
  return { xp, best, newBadges };
}

/** Tally one graded answer against its skill tags (gen, type, mode, stat). */
export function recordAnswer(tags: readonly string[], correct: boolean) {
  if (!tags.length) return;
  const p = read();
  const skills = { ...p.skills };
  for (const tag of tags) {
    const [c, n] = skills[tag] ?? [0, 0];
    skills[tag] = [c + (correct ? 1 : 0), n + 1];
  }
  write({ ...p, skills });
}

export function saveDle(date: string, record: DleRecord): BadgeDef[] {
  const p: Progress = structuredClone(read());
  const existing = p.dle.results[date];
  p.dle.results[date] = record;
  let fresh: BadgeDef[] = [];
  if (record.over && !existing?.over) {
    if (record.solved) {
      p.dle.streak = streakAfter(p.dle.last, p.dle.streak, date);
      p.dle.best = Math.max(p.dle.best, p.dle.streak);
      p.xp += 20 + (8 - record.guesses.length) * 10;
      const earned: string[] = [];
      if (record.guesses.length <= 3) earned.push("dle-3");
      if (record.guesses.length === 1) earned.push("dle-1");
      fresh = award(p, earned, Date.now());
    } else {
      p.dle.streak = 0;
    }
    p.dle.last = date;
  }
  write(p);
  return fresh;
}
