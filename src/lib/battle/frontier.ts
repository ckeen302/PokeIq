/**
 * The Battle Frontier facilities: runs of battles against the computer.
 *
 * - Battle Factory: rent a team of Showdown's Battle Factory sets; after each
 *   win you may swap one of your Pokémon for one of the beaten trainer's.
 * - Battle Tower: your own team under Flat Rules (level 50, bring 6 pick 3);
 *   every 7th battle is the Tower Tycoon.
 *
 * Runs go in rounds of 7 battles, the computer getting stronger as the
 * streak grows. Shared by the server (which signs each run's state, so a
 * streak can't be made up) and the pages. Nothing here imports the simulator.
 */

import type { CpuLevel } from "./play";

export type FrontierMode = "factory" | "tower";
/** Factory styles: Showdown's "[Gen 9] Battle Factory" (level 100, 6 v 6, Standard) or "[Gen 9] BSS Factory" (level 50, pick 3, Flat Rules). */
export type FactoryStyle = "open" | "bss";
/** What a best streak is kept under. */
export type FrontierKey = "factory" | "bssfactory" | "tower";

export const FRONTIER_ROUND = 7;

export const frontierKey = (mode: FrontierMode, style?: FactoryStyle): FrontierKey => (mode === "tower" ? "tower" : style === "bss" ? "bssfactory" : "factory");

export const FRONTIER_INFO: Record<FrontierKey, { name: string; blurb: string }> = {
  factory: { name: "Battle Factory", blurb: "Level 100, six on six, Showdown's Standard rules and Battle Factory sets." },
  bssfactory: { name: "BSS Factory", blurb: "Level 50, bring six and pick three, Flat Rules and Battle Stadium sets." },
  tower: { name: "Battle Tower", blurb: "Your team under Flat Rules: level 50, bring six, pick three. Every seventh battle is the Tower Tycoon." },
};

/** Where a streak stands: round 1 is battles 1-7, and so on. */
export function frontierStage(streak: number): { round: number; battle: number } {
  const s = Math.max(0, Math.floor(streak));
  return { round: Math.floor(s / FRONTIER_ROUND) + 1, battle: (s % FRONTIER_ROUND) + 1 };
}

/** The Tower's 7th battle of every round is against the Tower Tycoon. */
export const isBoss = (mode: FrontierMode, streak: number) => mode === "tower" && frontierStage(streak).battle === FRONTIER_ROUND;

/** The computer gets stronger through a round, and stays strong after the first. */
export function frontierCpuLevel(mode: FrontierMode, streak: number): CpuLevel {
  if (isBoss(mode, streak)) return "hard";
  const { round, battle } = frontierStage(streak);
  if (round >= 2) return battle <= 3 ? "normal" : "hard";
  return battle <= 2 ? "easy" : battle <= 5 ? "normal" : "hard";
}

/** A run's streak after a battle: one more on a win; a loss ends the run where it stood. */
export function afterBattle(streak: number, won: boolean): { streak: number; over: boolean } {
  return won ? { streak: streak + 1, over: false } : { streak, over: true };
}

/** The better of two bests. */
export const bestOf = (a: number | null | undefined, b: number | null | undefined) => Math.max(a ?? 0, b ?? 0);

interface SwapSet {
  species: string;
  item?: string;
}

export type SwapResult<T> = { ok: true; team: T[] } | { ok: false; error: string };

/**
 * The Factory's trade: your `give`th Pokémon for their `take`th. Species
 * Clause (and Item Clause, in BSS) still holds after the trade; `base` maps
 * a species to the name the clause compares (its base species).
 */
export function swapTeam<T extends SwapSet>(
  mine: readonly T[],
  theirs: readonly T[],
  give: number,
  take: number,
  opts: { itemClause?: boolean; base?: (species: string) => string } = {}
): SwapResult<T> {
  if (!Number.isInteger(give) || give < 0 || give >= mine.length) return { ok: false, error: "Pick one of your Pokémon to give up." };
  if (!Number.isInteger(take) || take < 0 || take >= theirs.length) return { ok: false, error: "Pick one of their Pokémon to take." };
  const base = opts.base ?? ((s: string) => s);
  const incoming = theirs[take];
  const team = mine.map((set, i) => (i === give ? { ...incoming } : set));
  const others = team.filter((_, i) => i !== give);
  if (others.some((set) => base(set.species) === base(incoming.species))) return { ok: false, error: `You already have ${base(incoming.species)} (Species Clause).` };
  if (opts.itemClause && incoming.item && others.some((set) => set.item === incoming.item)) return { ok: false, error: `Another of your Pokémon already holds ${incoming.item} (Item Clause).` };
  return { ok: true, team };
}

// ---------------------------------------------------------------------------
// What the pages receive
// ---------------------------------------------------------------------------

/** A Pokémon as a run shows it: your own team in full; a beaten trainer's team for the Factory swap. */
export interface FrontierMon {
  species: string;
  item: string;
  ability: string;
  moves: string[];
  level: number;
  teraType?: string;
}

export interface FrontierRunView {
  /** The run's signed state: send it back for the next battle or a swap. */
  token: string;
  mode: FrontierMode;
  style?: FactoryStyle;
  key: FrontierKey;
  /** The Factory's tier for this run ("OU", "UU", ...). */
  tier?: string;
  name: string;
  /** Battles won in a row. */
  streak: number;
  over: boolean;
  team: FrontierMon[];
  /** After a Factory win: the beaten team, to swap one in. */
  offer?: FrontierMon[];
  next: { round: number; battle: number; boss: boolean; level: CpuLevel };
}

/** What a battle's view says about the run it belongs to. */
export interface FrontierBattleInfo {
  mode: FrontierMode;
  key: FrontierKey;
  style?: FactoryStyle;
  tier?: string;
  streak: number;
  round: number;
  battle: number;
  boss: boolean;
}

// ---------------------------------------------------------------------------
// On this device: the run in progress and the best streaks
// ---------------------------------------------------------------------------

const RUN_KEY = (key: FrontierKey) => `pokeiq:frontier:run:${key}`;
const BEST_KEY = "pokeiq:frontier:best";

export function savedRun(key: FrontierKey): FrontierRunView | null {
  try {
    const raw = window.localStorage.getItem(RUN_KEY(key));
    return raw ? (JSON.parse(raw) as FrontierRunView) : null;
  } catch {
    return null;
  }
}

export function saveRun(run: FrontierRunView | null, key: FrontierKey = run?.key ?? "factory") {
  try {
    if (run && !run.over) window.localStorage.setItem(RUN_KEY(key), JSON.stringify(run));
    else window.localStorage.removeItem(RUN_KEY(key));
  } catch {
    // the run lives for this page only
  }
}

export function localBests(): Partial<Record<FrontierKey, number>> {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: Partial<Record<FrontierKey, number>> = {};
    for (const k of ["factory", "bssfactory", "tower"] as const) if (typeof parsed[k] === "number") out[k] = parsed[k] as number;
    return out;
  } catch {
    return {};
  }
}

/** Keeps a streak if it's the best on this device; returns the best. */
export function rememberBest(key: FrontierKey, streak: number): number {
  const bests = localBests();
  const best = bestOf(bests[key], streak);
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify({ ...bests, [key]: best }));
  } catch {
    // best kept on the server only (if signed in)
  }
  return best;
}
