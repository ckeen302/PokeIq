import { DLE_HINT_KINDS } from "./dle-types";
import { isDleAssist } from "./dle-assist";
import type { DailyRecord, DleRecord, Progress } from "./progress";

/**
 * Pure helpers for syncing progress between the browser and a trainer
 * account. Shared by the client (merging on sign-in) and the server
 * (validating what gets stored), so no "use client" here.
 */

const MAX_BYTES = 256 * 1024;

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v))) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
}

function streakBlock<T>(v: unknown, record: (r: unknown) => T | null): StreakBlock<T> {
  const o = obj(v);
  const results: Record<string, T> = {};
  for (const [date, r] of Object.entries(obj(o.results))) {
    const parsed = isDate(date) ? record(r) : null;
    if (parsed) results[date] = parsed;
  }
  return { last: isDate(o.last) ? o.last : null, streak: num(o.streak), best: num(o.best), results };
}

function dailyRecord(v: unknown): DailyRecord | null {
  const o = obj(v);
  if (typeof o.score !== "number" || typeof o.grid !== "string") return null;
  return {
    score: num(o.score),
    correct: num(o.correct),
    total: num(o.total),
    grid: o.grid.slice(0, 64),
    pokeiq: num(o.pokeiq, 100),
    ...(str(o.shareToken) && { shareToken: str(o.shareToken)!.slice(0, 2048) }),
  };
}

function dleRecord(v: unknown): DleRecord | null {
  const o = obj(v);
  if (!Array.isArray(o.guesses)) return null;
  return {
    guesses: o.guesses.filter((g): g is number => Number.isInteger(g)).slice(0, 8),
    solved: o.solved === true,
    over: o.over === true,
    ...(o.hard === true && { hard: true }),
    ...(Array.isArray(o.hints) && { hints: DLE_HINT_KINDS.filter((h) => (o.hints as unknown[]).includes(h)) }),
    ...(isDleAssist(o.assist) && { assist: o.assist }),
  };
}

/** Coerces untrusted JSON into a well-formed Progress, or null if it isn't one. */
export function normalizeProgress(raw: unknown): Progress | null {
  const o = obj(raw);
  if (o.v !== 1) return null;
  try {
    if (JSON.stringify(raw).length > MAX_BYTES) return null;
  } catch {
    return null;
  }
  const skills: Record<string, [number, number]> = {};
  for (const [tag, pair] of Object.entries(obj(o.skills))) {
    if (Array.isArray(pair) && pair.length === 2) skills[tag.slice(0, 40)] = [num(pair[0]), num(pair[1])];
  }
  return {
    v: 1,
    name: (str(o.name) ?? "").slice(0, 24),
    xp: num(o.xp),
    rating: typeof o.rating === "number" && Number.isFinite(o.rating) ? o.rating : null,
    runs: num(o.runs),
    answered: num(o.answered),
    correct: num(o.correct),
    bestStreak: num(o.bestStreak),
    best: numberMap(o.best),
    modulesPlayed: Array.isArray(o.modulesPlayed)
      ? o.modulesPlayed.filter((m): m is string => typeof m === "string").slice(0, 20)
      : [],
    daily: streakBlock(o.daily, dailyRecord),
    dle: streakBlock(o.dle, dleRecord),
    badges: numberMap(o.badges),
    skills,
  };
}

interface StreakBlock<T> {
  last: string | null;
  streak: number;
  best: number;
  results: Record<string, T>;
}

function laterStreak<T>(a: StreakBlock<T>, b: StreakBlock<T>): StreakBlock<T> {
  // The side that finished a puzzle most recently holds the live streak.
  const lead = (a.last ?? "") >= (b.last ?? "") ? a : b;
  return {
    last: lead.last,
    streak: lead.streak,
    best: Math.max(a.best, b.best),
    results: { ...b.results, ...a.results },
  };
}

/**
 * Combines the progress on this device with the account's copy. Totals take
 * the larger side (playing the same history on two devices shouldn't double
 * it), while badges, daily results and per-mode bests are unioned.
 */
export function mergeProgress(local: Progress, remote: Progress): Progress {
  const lead = local.runs >= remote.runs ? local : remote;
  const best: Record<string, number> = { ...remote.best };
  for (const [k, v] of Object.entries(local.best)) best[k] = Math.max(best[k] ?? 0, v);
  const badges: Record<string, number> = { ...remote.badges };
  for (const [k, t] of Object.entries(local.badges)) badges[k] = badges[k] ? Math.min(badges[k], t) : t;
  const skills: Record<string, [number, number]> = { ...remote.skills };
  for (const [k, pair] of Object.entries(local.skills)) if (!skills[k] || pair[1] > skills[k][1]) skills[k] = pair;

  return {
    v: 1,
    name: local.name || remote.name,
    xp: Math.max(local.xp, remote.xp),
    rating: lead.rating ?? local.rating ?? remote.rating,
    runs: Math.max(local.runs, remote.runs),
    answered: Math.max(local.answered, remote.answered),
    correct: Math.max(local.correct, remote.correct),
    bestStreak: Math.max(local.bestStreak, remote.bestStreak),
    best,
    modulesPlayed: [...new Set([...remote.modulesPlayed, ...local.modulesPlayed])],
    daily: laterStreak(local.daily, remote.daily),
    dle: laterStreak(local.dle, remote.dle),
    badges,
    skills,
  };
}
