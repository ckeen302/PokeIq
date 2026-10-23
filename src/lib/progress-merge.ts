import { DLE_HINT_KINDS } from "./dle-types";
import { isDleAssist } from "./dle-assist";
import type { ConnRecord, DailyRecord, DleRecord, Progress } from "./progress";
import { EMPTY_CONN_PLAY, type ConnPlay } from "./connections/play";
import { EMPTY_PDK_PLAY, PDK_COUNTERS, type PdkPlay, type PdkRecord } from "./pikadoku/play";

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
    guesses: o.guesses.filter((g): g is number => Number.isInteger(g)).slice(0, 10),
    solved: o.solved === true,
    over: o.over === true,
    ...(o.hard === true && { hard: true }),
    ...(Array.isArray(o.hints) && { hints: DLE_HINT_KINDS.filter((h) => (o.hints as unknown[]).includes(h)) }),
    ...(isDleAssist(o.assist) && { assist: o.assist }),
  };
}

function connRecord(v: unknown): ConnRecord | null {
  const o = obj(v);
  if (!Array.isArray(o.guesses)) return null;
  const guesses = o.guesses
    .filter((g): g is unknown[] => Array.isArray(g) && g.length === 4)
    .map((g) => g.filter((id): id is number => Number.isInteger(id) && (id as number) > 0))
    .filter((g) => g.length === 4)
    .slice(0, 12);
  return {
    guesses,
    solved: o.solved === true,
    over: o.over === true,
    mistakes: Math.min(4, Math.floor(num(o.mistakes))),
    ...(typeof o.ms === "number" && Number.isFinite(o.ms) && o.ms >= 0 && { ms: Math.round(o.ms) }),
  };
}

function pdkRecord(v: unknown): PdkRecord | null {
  const o = obj(v);
  if (!Array.isArray(o.guesses)) return null;
  const guesses = o.guesses
    .map((g) => obj(g))
    .filter((g) => Number.isInteger(g.cell) && (g.cell as number) >= 0 && (g.cell as number) < 9 && Number.isInteger(g.id) && (g.id as number) > 0)
    .map((g) => ({ cell: g.cell as number, id: g.id as number }))
    .slice(0, 40);
  return {
    guesses,
    won: o.won === true,
    over: o.over === true,
    solved: Math.min(9, Math.floor(num(o.solved))),
    score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : null,
    ...(typeof o.ms === "number" && Number.isFinite(o.ms) && o.ms >= 0 && { ms: Math.round(o.ms) }),
  };
}

function pdkPlayOf(v: unknown): PdkPlay {
  const o = obj(v);
  const out: PdkPlay = { ...EMPTY_PDK_PLAY, duels: [] };
  for (const k of PDK_COUNTERS) out[k] = Math.floor(num(o[k]));
  if (Array.isArray(o.duels)) out.duels = o.duels.filter((d): d is string => typeof d === "string").slice(-50);
  return out;
}

function mergePdkPlay(a: PdkPlay | undefined, b: PdkPlay | undefined): PdkPlay {
  const [x, y] = [a ?? EMPTY_PDK_PLAY, b ?? EMPTY_PDK_PLAY];
  const out: PdkPlay = { ...EMPTY_PDK_PLAY, duels: [...new Set([...y.duels, ...x.duels])].slice(-50) };
  for (const k of PDK_COUNTERS) out[k] = Math.max(x[k], y[k]);
  return out;
}

const CONN_COUNTERS = ["wins", "perfect", "hard", "duelWins", "duelLosses", "duelDraws"] as const;

function connPlayOf(v: unknown): ConnPlay {
  const o = obj(v);
  const out: ConnPlay = { ...EMPTY_CONN_PLAY, duels: [] };
  for (const k of CONN_COUNTERS) out[k] = Math.floor(num(o[k]));
  out.duels = Array.isArray(o.duels) ? o.duels.filter((c): c is string => typeof c === "string" && /^[a-hjkmnp-z2-9]{8}$/.test(c)).slice(-50) : [];
  return out;
}

/** Tallies take the larger side (the same games on two devices aren't counted twice); counted duels are unioned. */
function mergeConnPlay(a: ConnPlay | undefined, b: ConnPlay | undefined): ConnPlay {
  const [x, y] = [a ?? EMPTY_CONN_PLAY, b ?? EMPTY_CONN_PLAY];
  const out: ConnPlay = { ...EMPTY_CONN_PLAY, duels: [...new Set([...y.duels, ...x.duels])].slice(-50) };
  for (const k of CONN_COUNTERS) out[k] = Math.max(x[k], y[k]);
  return out;
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
    ...(o.squirdle !== undefined && { squirdle: streakBlock(o.squirdle, dleRecord) }),
    ...(o.conn !== undefined && { conn: streakBlock(o.conn, connRecord) }),
    ...(o.connPlay !== undefined && { connPlay: connPlayOf(o.connPlay) }),
    ...(o.pdk !== undefined && { pdk: streakBlock(o.pdk, pdkRecord) }),
    ...(o.pdkPlay !== undefined && { pdkPlay: pdkPlayOf(o.pdkPlay) }),
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

const EMPTY_BLOCK: StreakBlock<DleRecord> = { last: null, streak: 0, best: 0, results: {} };
const EMPTY_PDK: StreakBlock<PdkRecord> = { last: null, streak: 0, best: 0, results: {} };
const EMPTY_CONN: StreakBlock<ConnRecord> = { last: null, streak: 0, best: 0, results: {} };

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
    ...((local.squirdle || remote.squirdle) && { squirdle: laterStreak(local.squirdle ?? EMPTY_BLOCK, remote.squirdle ?? EMPTY_BLOCK) }),
    ...((local.conn || remote.conn) && { conn: laterStreak(local.conn ?? EMPTY_CONN, remote.conn ?? EMPTY_CONN) }),
    ...((local.pdk || remote.pdk) && { pdk: laterStreak(local.pdk ?? EMPTY_PDK, remote.pdk ?? EMPTY_PDK) }),
    ...((local.pdkPlay || remote.pdkPlay) && { pdkPlay: mergePdkPlay(local.pdkPlay, remote.pdkPlay) }),
    ...((local.connPlay || remote.connPlay) && { connPlay: mergeConnPlay(local.connPlay, remote.connPlay) }),
    badges,
    skills,
  };
}
