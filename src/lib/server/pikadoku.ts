import "server-only";
import dailies from "@/data/pikadoku-dailies.json";
import { allFacts, baseOf, categoryById, membersOf } from "@/lib/pikadoku/categories";
import { generateGrid, gridFromIds, type PdkGrid, type PdkGridIds } from "@/lib/pikadoku/generator";
import { softLockSafe } from "@/lib/pikadoku/solve";
import {
  DEFAULT_PDK_SETTINGS,
  PDK_CELLS,
  PDK_FAMILIES,
  PDK_PP,
  type PdkDifficulty,
  type PdkFamily,
  type PdkGridView,
  type PdkGuess,
  type PdkReveal,
  type PdkSettings,
} from "@/lib/pikadoku/types";

/**
 * Pikadoku on the server: the day's grids, checking a guess, and replaying a
 * whole game. Cell validity is only ever decided here, and a cell's valid
 * answers are returned only by `revealFor`, once the replay says it's over.
 */

const NAMES = new Map(allFacts().map((f) => [f.id, f.name]));
export const pokemonName = (id: number) => NAMES.get(id) ?? `#${id}`;
export const isDexId = (id: number) => NAMES.has(id);

const FILE = dailies as unknown as Record<string, Record<PdkDifficulty, PdkGridIds>>;
const cache = new Map<string, PdkGrid>();
const remember = (key: string, make: () => PdkGrid) => {
  let g = cache.get(key);
  if (!g) {
    if (cache.size > 300) cache.clear();
    cache.set(key, (g = make()));
  }
  return g;
};

/** A daily's grid: from the pre-generated year, else generated from the same seed. */
export function dailyGrid(date: string, difficulty: PdkDifficulty): PdkGrid {
  return remember(`d:${date}:${difficulty}`, () => gridFromIds(FILE[date]?.[difficulty] ?? generateGrid(date, { difficulty })));
}

/** An Unlimited grid from its seed and settings (the same seed always deals the same grid). */
export function practiceGrid(seed: string, settings: PdkSettings): PdkGrid {
  const fams = PDK_FAMILIES.filter((f) => settings.families.includes(f)).join(",");
  return remember(`p:${seed}:${fams}:${settings.allowSingle}`, () => gridFromIds(generateGrid(seed, { difficulty: "normal", families: settings.families, allowSingle: settings.allowSingle })));
}

/** Reads Unlimited's settings from query/body values, falling back to the defaults. */
export function parseSettings(raw: Partial<Record<keyof PdkSettings, unknown>> | undefined): PdkSettings {
  const d = DEFAULT_PDK_SETTINGS;
  const fams = Array.isArray(raw?.families) ? PDK_FAMILIES.filter((f) => (raw!.families as unknown[]).includes(f)) : d.families;
  return {
    unlimitedPP: raw?.unlimitedPP === true,
    softLockGuard: raw?.softLockGuard !== false,
    allowSingle: raw?.allowSingle === true,
    timer: raw?.timer === true,
    families: (fams.length ? fams : d.families) as PdkFamily[],
  };
}

/** The grid's categories, never their members. */
export function gridView(g: PdkGrid): PdkGridView {
  const v = (c: { id: string; family: PdkFamily; label: string }) => ({ id: c.id, family: c.family, label: c.label });
  return { rows: g.rows.map(v), cols: g.cols.map(v) };
}

export interface PdkReplay {
  /** cell -> Pokémon id for the cells locked in. */
  locked: Map<number, number>;
  wrong: PdkGuess[];
  /** Guesses spent: locked + wrong. */
  used: number;
  over: boolean;
  won: boolean;
}

/** Plays guesses in order. Throws on an impossible history (a repeat, a cell twice, a guess after the end). */
export function replayGuesses(g: PdkGrid, guesses: PdkGuess[], opts: { pp: number | null; giveUp?: boolean }): PdkReplay {
  const locked = new Map<number, number>();
  const taken = new Set<number>();
  const wrong: PdkGuess[] = [];
  const isOver = () => locked.size === PDK_CELLS || (opts.pp !== null && locked.size + wrong.length >= opts.pp);
  for (const x of guesses) {
    if (isOver()) throw new Error("That game was already over.");
    if (!Number.isInteger(x.cell) || x.cell < 0 || x.cell >= PDK_CELLS || !isDexId(x.id)) throw new Error("Bad guess.");
    if (locked.has(x.cell) || taken.has(baseOf(x.id))) throw new Error("That cell or Pokémon was already used.");
    if (g.answers[x.cell].includes(x.id)) {
      locked.set(x.cell, x.id);
      taken.add(baseOf(x.id));
    } else wrong.push(x);
  }
  const over = isOver() || !!opts.giveUp;
  return { locked, wrong, used: locked.size + wrong.length, over, won: locked.size === PDK_CELLS };
}

export type PdkCheck = { ok: true; valid: boolean; softlock?: boolean } | { ok: false; error: string };

/** One new guess against the history so far. A soft-locking pick (with the guard on) is refused and costs nothing. */
export function checkGuess(g: PdkGrid, history: PdkGuess[], next: PdkGuess, opts: { pp: number | null; guard: boolean }): PdkCheck {
  let r: PdkReplay;
  try {
    r = replayGuesses(g, history, { pp: opts.pp });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (r.over) return { ok: false, error: "That game is over." };
  if (!Number.isInteger(next.cell) || next.cell < 0 || next.cell >= PDK_CELLS || !isDexId(next.id)) return { ok: false, error: "Bad guess." };
  if (r.locked.has(next.cell)) return { ok: false, error: "That cell is already filled." };
  if ([...r.locked.values()].some((l) => baseOf(l) === baseOf(next.id))) return { ok: false, error: "You've already used that Pokémon (or its other form)." };
  const valid = g.answers[next.cell].includes(next.id);
  if (valid && opts.guard && !softLockSafe(g.answers, r.locked, next.cell, next.id)) return { ok: true, valid: true, softlock: true };
  return { ok: true, valid };
}

/** After the game: every valid answer per cell (rarest first when `pct` is known) and why each miss didn't fit. */
export function revealFor(g: PdkGrid, wrong: PdkGuess[], pct?: (cell: number, id: number) => number | null): PdkReveal {
  const cells = g.answers.map((ids, cell) => {
    const answers = ids.map((id) => ({ id, name: pokemonName(id), pct: pct?.(cell, id) ?? null }));
    answers.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.name.localeCompare(b.name));
    return { total: ids.length, answers };
  });
  const misses = wrong.map(({ cell, id }) => {
    const row = g.rows[Math.floor(cell / 3)];
    const col = g.cols[cell % 3];
    const failed = [row, col].filter((c) => !membersOf(categoryById(c.id)!)[id]).map((c) => `"${c.label}"`);
    return { cell, id, name: pokemonName(id), reason: `${pokemonName(id)} doesn't match ${failed.join(" or ")}.` };
  });
  return { cells, misses };
}

/** Rules for a daily: nine guesses; Unlimited may lift the cap. */
export const ppFor = (daily: boolean, settings: PdkSettings): number | null => (daily ? PDK_PP : settings.unlimitedPP ? null : PDK_PP);
