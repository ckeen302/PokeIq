import type { ArtStyle } from "./art";
import { BLIND_LENGTHS, type BlindLength } from "./blind";
import type { BracketSize, Seeding } from "./bracket";
import { getTemplate } from "./templates";
import type { Mon } from "./types";
import { newSeed } from "./rng";

/**
 * Everything the maker remembers for one template: its pool (the template's Pokémon, plus any added, minus any
 * removed), the look (HD or Pixel, shiny), and each mode's own progress, so switching modes never loses work.
 */

export type Mode = "tier" | "bracket" | "top" | "blind";
export const MODES: readonly Mode[] = ["tier", "bracket", "top", "blind"];

export interface TierRow {
  id: string;
  label: string;
  /** #rrggbb */
  color: string;
  items: string[];
}

export const TOP_LENGTHS = [3, 5, 10, 25] as const;
export type TopLength = (typeof TOP_LENGTHS)[number];

export interface BracketState {
  size: BracketSize;
  seeding: Seeding;
  seed: string;
  /** Manual seeding: keys, seed 1 first. */
  manual: string[];
  picks: number[];
  /** Past the setup (the matchups are on). */
  started: boolean;
}

export interface TopState {
  length: TopLength;
  items: string[];
  captions: Record<string, string>;
}

export interface BlindState {
  length: BlindLength;
  seed: string;
  /** Draw from the template's pool, or from every Pokémon. */
  source: "template" | "random";
  slots: number[];
  /** A friend's run of the same draw (from their challenge link), shown side by side. */
  vs?: { name: string; slots: number[] };
  /** The player's name, carried on the challenge link. */
  name?: string;
}

export interface ToolState {
  template: string;
  added: string[];
  removed: string[];
  mode: Mode;
  art: ArtStyle;
  shiny: boolean;
  /** The player's own title; empty uses the template's name. */
  title: string;
  tileSize: number;
  tier: { rows: TierRow[] };
  bracket: BracketState;
  top: TopState;
  blind: BlindState;
}

/** The six starting tiers, in colours of the site's palette that still read as the familiar S-to-F ramp. */
export const TIER_COLORS = ["#f25f7d", "#f7954a", "#f6c94a", "#8fd46a", "#4fb8e8", "#9a7cf4", "#e46fd2", "#7f8aa3", "#3fd1b5", "#f2f0e6"];
const DEFAULT_TIERS = ["S", "A", "B", "C", "D", "F"];

let rowCounter = 0;
export const newRowId = () => `r${Date.now().toString(36)}${(rowCounter++).toString(36)}`;

export function defaultRows(): TierRow[] {
  return DEFAULT_TIERS.map((label, i) => ({ id: `t${i}`, label, color: TIER_COLORS[i], items: [] }));
}

export const MIN_TILE = 56;
export const MAX_TILE = 128;
export const DEFAULT_TILE = 80;

export function initialState(template: string, seed: string = newSeed()): ToolState {
  return {
    template,
    added: [],
    removed: [],
    mode: "tier",
    art: "hd",
    shiny: false,
    title: "",
    tileSize: DEFAULT_TILE,
    tier: { rows: defaultRows() },
    bracket: { size: 16, seeding: "random", seed, manual: [], picks: [], started: false },
    top: { length: 10, items: [], captions: {} },
    blind: { length: 10, seed, source: "template", slots: Array.from({ length: 10 }, () => -1) },
  };
}

/** The template's pool: its Pokémon (minus removed) plus added ones, always in roster order (draws replay from it). */
export function poolKeys(state: Pick<ToolState, "template" | "added" | "removed">, mons: readonly Mon[]): string[] {
  const t = getTemplate(state.template);
  const removed = new Set(state.removed);
  const added = new Set(state.added);
  return mons.filter((m) => !removed.has(m.k) && (added.has(m.k) || (t ? t.filter(m) : false))).map((m) => m.k);
}

/** Every key placed in a tier. */
export function placedInTiers(state: ToolState): Set<string> {
  return new Set(state.tier.rows.flatMap((r) => r.items));
}

/** Drops keys that aren't in the pool any more from every mode (after removing Pokémon or a data change). */
export function prune(state: ToolState, pool: readonly string[]): ToolState {
  const ok = new Set(pool);
  const rows = state.tier.rows.map((r) => (r.items.every((k) => ok.has(k)) ? r : { ...r, items: r.items.filter((k) => ok.has(k)) }));
  const changed = rows.some((r, i) => r !== state.tier.rows[i]);
  const items = state.top.items.filter((k) => ok.has(k));
  return {
    ...state,
    tier: changed ? { rows } : state.tier,
    top: items.length === state.top.items.length ? state.top : { ...state.top, items },
  };
}

// ---- Tier list edits (pure: each returns a new state).

/** Moves keys into a row at an index (−1: the end), or back to the pool (row null). Keeps their order. */
export function moveToTier(state: ToolState, keys: readonly string[], rowId: string | null, index = -1): ToolState {
  if (!keys.length) return state;
  const moving = new Set(keys);
  let insertAt = index;
  const rows = state.tier.rows.map((r) => {
    if (r.id === rowId && insertAt >= 0) {
      // Indices count the row as it is now: items before the drop point that are moving shift it left.
      insertAt -= r.items.slice(0, insertAt).filter((k) => moving.has(k)).length;
    }
    const items = r.items.filter((k) => !moving.has(k));
    return items.length === r.items.length ? r : { ...r, items };
  });
  if (rowId === null) return { ...state, tier: { rows } };
  return {
    ...state,
    tier: {
      rows: rows.map((r) => {
        if (r.id !== rowId) return r;
        const items = r.items.slice();
        const at = insertAt < 0 || insertAt > items.length ? items.length : insertAt;
        items.splice(at, 0, ...keys);
        return { ...r, items };
      }),
    },
  };
}

export function updateRow(state: ToolState, rowId: string, patch: Partial<Pick<TierRow, "label" | "color">>): ToolState {
  return { ...state, tier: { rows: state.tier.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) } };
}

/** Adds an empty tier after a row (or before it), or at the end. */
export function addRow(state: ToolState, next?: string, before = false): ToolState {
  const rows = state.tier.rows.slice();
  const i = next ? rows.findIndex((r) => r.id === next) : -1;
  const at = i < 0 ? rows.length : before ? i : i + 1;
  const used = new Set(rows.map((r) => r.color));
  const color = TIER_COLORS.find((c) => !used.has(c)) ?? TIER_COLORS[rows.length % TIER_COLORS.length];
  rows.splice(at, 0, { id: newRowId(), label: "", color, items: [] });
  return { ...state, tier: { rows } };
}

/** Removes a row; its Pokémon go back to the pool. The last row stays. */
export function removeRow(state: ToolState, rowId: string): ToolState {
  if (state.tier.rows.length <= 1) return state;
  return { ...state, tier: { rows: state.tier.rows.filter((r) => r.id !== rowId) } };
}

export function moveRow(state: ToolState, rowId: string, delta: number): ToolState {
  const rows = state.tier.rows.slice();
  const i = rows.findIndex((r) => r.id === rowId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= rows.length) return state;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  return { ...state, tier: { rows } };
}

export function clearTiers(state: ToolState): ToolState {
  return { ...state, tier: { rows: state.tier.rows.map((r) => ({ ...r, items: [] })) } };
}

// ---- Top N edits.

export function topAdd(state: ToolState, key: string, index = -1): ToolState {
  const items = state.top.items.filter((k) => k !== key);
  if (items.length >= state.top.length && !state.top.items.includes(key)) return state;
  const at = index < 0 || index > items.length ? items.length : index;
  items.splice(at, 0, key);
  return { ...state, top: { ...state.top, items: items.slice(0, state.top.length) } };
}

export function topRemove(state: ToolState, key: string): ToolState {
  return { ...state, top: { ...state.top, items: state.top.items.filter((k) => k !== key) } };
}

export function topLength(state: ToolState, length: TopLength): ToolState {
  return { ...state, top: { ...state.top, length, items: state.top.items.slice(0, length) } };
}

// ---- Blind edits.

export function blindReset(state: ToolState, patch: Partial<Pick<BlindState, "length" | "seed" | "source">> = {}): ToolState {
  const length = patch.length ?? state.blind.length;
  return {
    ...state,
    blind: {
      ...state.blind,
      ...patch,
      length: (BLIND_LENGTHS as readonly number[]).includes(length) ? length : 10,
      slots: Array.from({ length }, () => -1),
      vs: patch.seed !== undefined || patch.length !== undefined || patch.source !== undefined ? undefined : state.blind.vs,
    },
  };
}

// ---- History: undo and redo over whole states.

export interface History {
  past: ToolState[];
  present: ToolState;
  future: ToolState[];
}

const LIMIT = 120;

export const historyOf = (present: ToolState): History => ({ past: [], present, future: [] });

/** Records a change (the same state again records nothing). */
export function commit(h: History, next: ToolState): History {
  if (next === h.present) return h;
  return { past: [...h.past.slice(-(LIMIT - 1)), h.present], present: next, future: [] };
}

/** Changes the present without a history step (typing in a title, the tile size). */
export function replace(h: History, next: ToolState): History {
  return next === h.present ? h : { ...h, present: next };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
