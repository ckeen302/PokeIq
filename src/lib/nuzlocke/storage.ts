import type { EncounterKind } from "./model";
import { BADGES_MAX, DEFAULT_RULES, NAME_MAX, NICK_MAX, RUN_VERSION, TEXT_MAX, type AreaResult, type Death, type MonStatus, type Rules, type Run, type RunMon } from "./run";

/**
 * The runs saved in this browser: one versioned localStorage key holding every run by id, and a few preferences. Read
 * back defensively (anything malformed is repaired or dropped, never thrown) and written one run at a time, re-reading
 * first, so two tabs on two runs don't overwrite each other. Every access is wrapped: private mode or full storage
 * just means nothing is saved, and the page says so.
 */

export const STORE_KEY = "pokeiq:nuzlocke:v1";
const RUNS_MAX = 100;
const MONS_MAX = 2000;

export type AreaFilter = "remaining" | "all" | "done";

export interface Prefs {
  /** The first-run tips were dismissed. */
  onboarded?: boolean;
  /** Each run's area filter. */
  filters?: Record<string, AreaFilter>;
}

export interface Store {
  v: 1;
  runs: Record<string, Run>;
  prefs: Prefs;
}

const EMPTY: Store = { v: 1, runs: {}, prefs: {} };
const KINDS: readonly EncounterKind[] = ["wild", "gift", "static", "trade", "egg", "fossil", "roaming"];
const STATUSES: readonly MonStatus[] = ["team", "box", "dead"];
const FILTERS: readonly AreaFilter[] = ["remaining", "all", "done"];

const isKey = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined);
const time = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 8.64e15 ? v : fallback);

function sanitizeDeath(raw: unknown, now: number): Death {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d: Death = { at: time(o.at, now) };
  const by = int(o.by, 1, 2000);
  if (by) d.by = by;
  if (text(o.byText, TEXT_MAX)) d.byText = text(o.byText, TEXT_MAX);
  if (isKey(o.area)) d.area = o.area;
  const level = int(o.level, 1, 100);
  if (level) d.level = level;
  return d;
}

function sanitizeMon(raw: unknown, now: number): RunMon | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isKey(o.id) || !isKey(o.area) || !isKey(o.met)) return null;
  const status = STATUSES.includes(o.status as MonStatus) ? (o.status as MonStatus) : "box";
  const m: RunMon = { id: o.id, area: o.area, met: o.met, mon: isKey(o.mon) ? o.mon : o.met, nickname: text(o.nickname, NICK_MAX), status, caughtAt: time(o.caughtAt, now) };
  if (o.shiny === true) m.shiny = true;
  if (o.free === true) m.free = true;
  if (KINDS.includes(o.kind as EncounterKind) && o.kind !== "wild") m.kind = o.kind as EncounterKind;
  const level = int(o.level, 1, 100);
  if (level) m.level = level;
  if (status === "dead") m.death = sanitizeDeath(o.death, now);
  return m;
}

function sanitizeRules(raw: unknown): Rules {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, typeof o[k] === "boolean" ? o[k] : v])) as unknown as Rules;
}

/** A run as read back (from storage or an imported file): repaired where it can be, null when it can't. */
export function sanitizeRun(raw: unknown, now = Date.now()): Run | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== RUN_VERSION || !isKey(o.id) || !isKey(o.game) || !isKey(o.version)) return null;
  const seen = new Set<string>();
  const mons = (Array.isArray(o.mons) ? o.mons : [])
    .map((m) => sanitizeMon(m, now))
    .filter((m): m is RunMon => !!m && !seen.has(m.id) && !!seen.add(m.id))
    .slice(0, MONS_MAX);
  // The team holds six: any beyond (a hand-edited file) wait in the box.
  let members = 0;
  for (const m of mons) if (m.status === "team" && ++members > 6) m.status = "box";
  const areas: Record<string, AreaResult> = {};
  const rawAreas = (o.areas && typeof o.areas === "object" ? o.areas : {}) as Record<string, unknown>;
  for (const [id, r] of Object.entries(rawAreas)) {
    if (!isKey(id) || !r || typeof r !== "object") continue;
    const a = r as Record<string, unknown>;
    if (a.kind === "caught" && isKey(a.mon) && seen.has(a.mon)) areas[id] = { kind: "caught", mon: a.mon };
    else if (a.kind === "failed") areas[id] = isKey(a.met) ? { kind: "failed", met: a.met } : { kind: "failed" };
    else if (a.kind === "skipped") areas[id] = { kind: "skipped" };
  }
  const created = time(o.createdAt, now);
  return {
    v: RUN_VERSION,
    id: o.id,
    game: o.game,
    version: o.version,
    name: text(o.name, NAME_MAX),
    rules: sanitizeRules(o.rules),
    areas,
    mons,
    beaten: Array.isArray(o.beaten) ? [...new Set(o.beaten.filter(isKey))].slice(0, 200) : [],
    badges: int(o.badges, 0, BADGES_MAX) ?? 0,
    createdAt: created,
    updatedAt: time(o.updatedAt, created),
  };
}

export function sanitizeStore(raw: unknown, now = Date.now()): Store {
  if (!raw || typeof raw !== "object") return EMPTY;
  const o = raw as Record<string, unknown>;
  const runs: Record<string, Run> = {};
  const rawRuns = (o.runs && typeof o.runs === "object" ? o.runs : {}) as Record<string, unknown>;
  for (const r of Object.values(rawRuns)) {
    const run = sanitizeRun(r, now);
    if (run) runs[run.id] = run;
  }
  const p = (o.prefs && typeof o.prefs === "object" ? o.prefs : {}) as Record<string, unknown>;
  const filters: Record<string, AreaFilter> = {};
  for (const [id, f] of Object.entries((p.filters && typeof p.filters === "object" ? p.filters : {}) as Record<string, unknown>)) if (runs[id] && FILTERS.includes(f as AreaFilter)) filters[id] = f as AreaFilter;
  return { v: 1, runs, prefs: { ...(p.onboarded === true && { onboarded: true }), ...(Object.keys(filters).length && { filters }) } };
}

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadStore(storage: Reader | null = browserStorage()): Store {
  try {
    const raw = storage?.getItem(STORE_KEY);
    return raw ? sanitizeStore(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(storage: Writer | null, change: (s: Store) => Store): boolean {
  try {
    if (!storage) return false;
    const next = change(loadStore(storage));
    // Over the cap, the runs played longest ago go first.
    const ids = Object.values(next.runs).sort((a, b) => b.updatedAt - a.updatedAt).map((r) => r.id);
    for (const id of ids.slice(RUNS_MAX)) delete next.runs[id];
    storage.setItem(STORE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Saves one run; false when the browser wouldn't (private mode, full storage). */
export const saveRun = (run: Run, storage: Writer | null = browserStorage()): boolean => write(storage, (s) => ({ ...s, runs: { ...s.runs, [run.id]: run } }));

export function deleteRun(id: string, storage: Writer | null = browserStorage()): boolean {
  return write(storage, (s) => {
    const runs = { ...s.runs };
    delete runs[id];
    const filters = { ...s.prefs.filters };
    delete filters[id];
    return { ...s, runs, prefs: { ...s.prefs, filters } };
  });
}

export const savePrefs = (prefs: Partial<Prefs>, storage: Writer | null = browserStorage()): boolean => write(storage, (s) => ({ ...s, prefs: { ...s.prefs, ...prefs } }));

export function setFilter(id: string, filter: AreaFilter, storage: Writer | null = browserStorage()): boolean {
  return write(storage, (s) => ({ ...s, prefs: { ...s.prefs, filters: { ...s.prefs.filters, [id]: filter } } }));
}

/** The runs saved here, played most recently first. */
export const listRuns = (store: Store): Run[] => Object.values(store.runs).sort((a, b) => b.updatedAt - a.updatedAt);

/* ---------- Backups: a run as a .json file ---------- */

export const BACKUP_KIND = "pokeiq-nuzlocke-run";

export function exportRun(run: Run): string {
  return JSON.stringify({ kind: BACKUP_KIND, v: 1, run }, null, 2);
}

/** A backup file's run, or null if the file isn't one. */
export function importRun(textIn: string, now = Date.now()): Run | null {
  try {
    const o = JSON.parse(textIn) as { kind?: unknown; run?: unknown };
    if (!o || o.kind !== BACKUP_KIND) return null;
    return sanitizeRun(o.run, now);
  } catch {
    return null;
  }
}

/** A file name for a run's backup: "pokeiq-nuzlocke-blaze-run-2026-11-28.json". */
export function backupName(run: Pick<Run, "name">, now = new Date()): string {
  const slug = run.name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `pokeiq-nuzlocke-${slug}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
