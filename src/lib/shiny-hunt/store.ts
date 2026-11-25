import { GAMES, getGame, getMethod, type ChoiceId, type GameId, type MethodId, type OddsInput } from "./odds";

/**
 * The Shiny Hunt Counter's saved hunts: kept in this browser (localStorage), read back defensively (anything malformed
 * is dropped or repaired, never thrown), and changed only through the pure functions below, so the page and the tests
 * share one set of rules. Tested in tests/shiny-hunt.test.ts.
 */

export const STORAGE_KEY = "pokeiq:shiny-hunts";
export const LAST_SPECIES = 1025;
/** The timer stops counting this long after the last tap (a hunt left open overnight doesn't run up hours). */
export const IDLE_MS = 10 * 60_000;
const UNDO_MAX = 60;
const HUNTS_MAX = 300;
export const COUNT_MAX = 9_999_999;
export const STEP_MAX = 99;
const NAME_MAX = 40;

export type HuntStatus = "active" | "found" | "archived";

/** A different shiny found along the way (a "phase"): the hunt carries on. */
export interface Phase {
  /** The shiny that turned up, if it was noted. */
  species: number | null;
  /** The hunt's count when it appeared. */
  at: number;
  date: number;
}

export interface Hunt extends OddsInput {
  id: string;
  species: number;
  /** A name the hunter gave it ("" shows the Pokémon's). */
  name: string;
  game: GameId;
  method: MethodId;
  count: number;
  step: number;
  /** Earlier counts, newest last, for undo. */
  undo: number[];
  phases: Phase[];
  status: HuntStatus;
  /** An archived hunt's status before (archiving a found hunt keeps it found when restored). */
  createdAt: number;
  updatedAt: number;
  /** Timer: time banked, when the running stretch started (null: paused), the last tap. */
  timeMs: number;
  runningSince: number | null;
  lastActive: number;
  /** Encounters counted while the timer ran (for encounters per hour). */
  timedCount: number;
  found: { date: number; count: number; timeMs: number } | null;
}

export interface Prefs {
  sound: boolean;
  haptics: boolean;
}

export interface HuntsState {
  v: 1;
  current: string | null;
  hunts: Hunt[];
  prefs: Prefs;
}

export const EMPTY_STATE: HuntsState = { v: 1, current: null, hunts: [], prefs: { sound: false, haptics: true } };

const int = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
const time = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 8.64e15 ? v : fallback);
const isSpecies = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= LAST_SPECIES;

export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().slice(0, 12);
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 14);
}

/** The game's first method that exists, if the method doesn't. */
export function fixMethod(game: GameId, method: string): MethodId {
  return getMethod(game, method)?.id ?? getGame(game)!.methods[0].id;
}

/** A hunt as read back from storage: repaired where it can be, null when it can't. */
export function sanitizeHunt(raw: unknown, now = Date.now()): Hunt | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id || o.id.length > 40 || !isSpecies(o.species)) return null;
  const game = getGame(String(o.game))?.id ?? "sv";
  const method = fixMethod(game, String(o.method));
  const m = getMethod(game, method)!;
  const choices: Partial<Record<ChoiceId, string>> = {};
  const rawChoices = (o.choices && typeof o.choices === "object" ? o.choices : {}) as Record<string, unknown>;
  for (const c of m.choices ?? []) {
    const v = rawChoices[c.id];
    if (typeof v === "string" && c.options.some((x) => x.id === v)) choices[c.id] = v;
  }
  const count = int(o.count, 0, COUNT_MAX, 0);
  const status: HuntStatus = o.status === "found" || o.status === "archived" ? o.status : "active";
  const f = o.found as Record<string, unknown> | null | undefined;
  const found = f && typeof f === "object" ? { date: time(f.date, now), count: int(f.count, 0, COUNT_MAX, count), timeMs: time(f.timeMs, 0) } : null;
  const phases = Array.isArray(o.phases)
    ? o.phases
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p) => ({ species: isSpecies(p.species) ? p.species : null, at: int(p.at, 0, COUNT_MAX, 0), date: time(p.date, now) }))
        .slice(0, 999)
    : [];
  const runningSince = o.runningSince === null || o.runningSince === undefined ? null : time(o.runningSince, now);
  return {
    id: o.id,
    species: o.species,
    name: typeof o.name === "string" ? o.name.slice(0, NAME_MAX) : "",
    game,
    method,
    charm: o.charm === true,
    lure: o.lure === true,
    chain: int(o.chain, 0, 9999, 0),
    choices,
    count,
    step: int(o.step, 1, STEP_MAX, m.step ?? 1),
    undo: Array.isArray(o.undo) ? o.undo.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= COUNT_MAX).slice(-UNDO_MAX) : [],
    phases,
    status: status === "found" && !found ? "active" : status,
    createdAt: time(o.createdAt, now),
    updatedAt: time(o.updatedAt, now),
    timeMs: time(o.timeMs, 0),
    runningSince,
    lastActive: time(o.lastActive, runningSince ?? now),
    timedCount: int(o.timedCount, 0, COUNT_MAX, 0),
    found,
  };
}

export function sanitizeState(raw: unknown, now = Date.now()): HuntsState {
  if (!raw || typeof raw !== "object") return EMPTY_STATE;
  const o = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const hunts = (Array.isArray(o.hunts) ? o.hunts : [])
    .map((h) => sanitizeHunt(h, now))
    .filter((h): h is Hunt => !!h && !seen.has(h.id) && !!seen.add(h.id))
    .slice(0, HUNTS_MAX);
  const p = (o.prefs && typeof o.prefs === "object" ? o.prefs : {}) as Record<string, unknown>;
  const current = typeof o.current === "string" && hunts.some((h) => h.id === o.current) ? o.current : null;
  return { v: 1, current, hunts, prefs: { sound: p.sound === true, haptics: p.haptics !== false } };
}

/** Reads the saved hunts (an empty state when storage is blocked or the data is unreadable). */
export function loadState(storage: Pick<Storage, "getItem"> | null = safeStorage()): HuntsState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

/** Saves the hunts; false when the browser wouldn't (private mode, full storage). */
export function saveState(state: HuntsState, storage: Pick<Storage, "setItem"> | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/* ---------- Hunts ---------- */

export function createHunt(species: number, game: GameId, now = Date.now(), from?: Pick<Hunt, "charm" | "method">): Hunt {
  const g = getGame(game) ?? GAMES[GAMES.length - 1];
  const method = from ? fixMethod(g.id, from.method) : g.methods[0].id;
  const m = getMethod(g.id, method)!;
  return {
    id: newId(),
    species,
    name: "",
    game: g.id,
    method,
    charm: from?.charm ?? false,
    lure: false,
    chain: 0,
    choices: {},
    count: 0,
    step: m.step ?? 1,
    undo: [],
    phases: [],
    status: "active",
    createdAt: now,
    updatedAt: now,
    timeMs: 0,
    runningSince: null,
    lastActive: now,
    timedCount: 0,
    found: null,
  };
}

/** The hunt's timed total: banked time plus the running stretch, which stops IDLE_MS after the last tap. */
export function elapsed(h: Pick<Hunt, "timeMs" | "runningSince" | "lastActive">, now = Date.now()): number {
  if (h.runningSince === null) return h.timeMs;
  const end = Math.min(now, h.lastActive + IDLE_MS);
  return h.timeMs + Math.max(0, end - h.runningSince);
}

/** Running, but nothing counted for IDLE_MS: the clock has stopped until the next tap. */
export function isIdle(h: Pick<Hunt, "runningSince" | "lastActive">, now = Date.now()): boolean {
  return h.runningSince !== null && now - h.lastActive > IDLE_MS;
}

function pushUndo(h: Hunt): number[] {
  return [...h.undo, h.count].slice(-UNDO_MAX);
}

/**
 * Adds `delta` encounters (negative takes some away, never below 0). The first tap starts the timer; a tap after the
 * timer went idle starts a new stretch from now.
 */
export function addCount(h: Hunt, delta: number, now = Date.now()): Hunt {
  const count = Math.min(COUNT_MAX, Math.max(0, h.count + Math.round(delta)));
  if (count === h.count) return h;
  let { timeMs, runningSince } = h;
  if (delta > 0 && runningSince === null && h.status === "active") runningSince = now;
  else if (runningSince !== null && isIdle(h, now)) {
    timeMs = elapsed(h, now);
    runningSince = now;
  }
  const timed = runningSince !== null ? Math.max(0, h.timedCount + (count - h.count)) : h.timedCount;
  return { ...h, count, undo: pushUndo(h), timeMs, runningSince, lastActive: now, timedCount: timed, updatedAt: now };
}

/** Sets the count outright (typed in); undo brings the old one back. */
export function setCount(h: Hunt, value: number, now = Date.now()): Hunt {
  const count = Math.min(COUNT_MAX, Math.max(0, Math.round(Number.isFinite(value) ? value : h.count)));
  if (count === h.count) return h;
  return { ...h, count, undo: pushUndo(h), updatedAt: now };
}

export function undo(h: Hunt, now = Date.now()): Hunt {
  if (!h.undo.length) return h;
  const count = h.undo[h.undo.length - 1];
  const diff = count - h.count;
  return { ...h, count, undo: h.undo.slice(0, -1), timedCount: Math.max(0, Math.min(h.timedCount + diff, count)), updatedAt: now };
}

export function pause(h: Hunt, now = Date.now()): Hunt {
  if (h.runningSince === null) return h;
  return { ...h, timeMs: elapsed(h, now), runningSince: null, updatedAt: now };
}

export function resume(h: Hunt, now = Date.now()): Hunt {
  if (h.runningSince !== null && !isIdle(h, now)) return h;
  return { ...h, timeMs: elapsed(h, now), runningSince: now, lastActive: now, updatedAt: now };
}

export function setStep(h: Hunt, step: number): Hunt {
  return { ...h, step: Math.min(STEP_MAX, Math.max(1, Math.round(step) || 1)) };
}

/** Changes game, method or bonuses; the method falls back to the game's first, the step to the new method's. */
export function setOdds(h: Hunt, patch: Partial<Pick<Hunt, "game" | "method" | "charm" | "lure" | "chain" | "choices">>, now = Date.now()): Hunt {
  const game = patch.game ?? h.game;
  const method = fixMethod(game, patch.method ?? h.method);
  const methodChanged = method !== h.method || game !== h.game;
  const m = getMethod(game, method)!;
  const choices = patch.choices ?? (methodChanged ? {} : h.choices);
  const next = { ...h, ...patch, game, method, choices, chain: Math.max(0, Math.min(9999, Math.round(patch.chain ?? (methodChanged ? 0 : h.chain)))), updatedAt: now };
  if (methodChanged && (m.step ?? 1) !== (getMethod(h.game, h.method)?.step ?? 1)) next.step = m.step ?? 1;
  return next;
}

/** A different shiny turned up: note it and keep going. */
export function addPhase(h: Hunt, species: number | null, now = Date.now()): Hunt {
  return { ...h, phases: [...h.phases, { species: species && isSpecies(species) ? species : null, at: h.count, date: now }], updatedAt: now };
}

export function removePhase(h: Hunt, index: number, now = Date.now()): Hunt {
  return { ...h, phases: h.phases.filter((_, i) => i !== index), updatedAt: now };
}

/** The target turned up: the hunt is done (the timer stops) and goes to the trophy case. */
export function markFound(h: Hunt, now = Date.now()): Hunt {
  const p = pause(h, now);
  return { ...p, status: "found", found: { date: now, count: h.count, timeMs: p.timeMs }, updatedAt: now };
}

/** Back to hunting (a found hunt marked by mistake, or an archived one). */
export function reopen(h: Hunt, now = Date.now()): Hunt {
  return { ...h, status: "active", found: null, updatedAt: now };
}

export function archive(h: Hunt, now = Date.now()): Hunt {
  return { ...pause(h, now), status: "archived", updatedAt: now };
}

/** An archived hunt back where it was: found if it had been, else active. */
export function unarchive(h: Hunt, now = Date.now()): Hunt {
  return { ...h, status: h.found ? "found" : "active", updatedAt: now };
}

export function rename(h: Hunt, name: string, now = Date.now()): Hunt {
  return { ...h, name: name.trim().slice(0, NAME_MAX), updatedAt: now };
}

/** Encounters since the last phase (the current phase's count). */
export function phaseCount(h: Pick<Hunt, "count" | "phases">): number {
  const last = h.phases[h.phases.length - 1];
  return last ? Math.max(0, h.count - last.at) : h.count;
}

/* ---------- State ---------- */

export function upsert(state: HuntsState, hunt: Hunt): HuntsState {
  const i = state.hunts.findIndex((h) => h.id === hunt.id);
  const hunts = i < 0 ? [hunt, ...state.hunts].slice(0, HUNTS_MAX) : state.hunts.map((h) => (h.id === hunt.id ? hunt : h));
  return { ...state, hunts };
}

export function removeHunt(state: HuntsState, id: string): HuntsState {
  const hunts = state.hunts.filter((h) => h.id !== id);
  const current = state.current === id ? (hunts.find((h) => h.status === "active")?.id ?? null) : state.current;
  return { ...state, hunts, current };
}

/** Hunts in progress, the most recently touched first. */
export function activeHunts(state: HuntsState): Hunt[] {
  return state.hunts.filter((h) => h.status === "active").sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Found shinies, the newest first. */
export function trophies(state: HuntsState): Hunt[] {
  return state.hunts.filter((h) => h.status === "found").sort((a, b) => (b.found?.date ?? 0) - (a.found?.date ?? 0));
}

export function archived(state: HuntsState): Hunt[] {
  return state.hunts.filter((h) => h.status === "archived").sort((a, b) => b.updatedAt - a.updatedAt);
}
