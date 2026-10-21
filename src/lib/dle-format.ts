import { DLE_COLUMNS, DLE_MAX_GUESSES, type CellStatus, type DleColumn } from "./dle-types";

/**
 * Pokédle's game formats and advanced settings, shared by the server (which
 * commits to them: it only computes and sends the columns a game shows, and
 * scores by them) and the browser (the settings panel, the board, the share).
 *
 * - Classic: all seven clues, with close (yellow) states. 8 guesses.
 * - Squirdle-style: Squirdle's own format (squirdle.fireblend.com): Gen,
 *   Type 1, Type 2, Height and Weight; ✓, ▲ / ▼ for gen, height and weight
 *   with no "close" state, and a type in the other slot marked as such. Its
 *   guess count scales with the generation range like Squirdle's: 5 for one
 *   or two generations, up to 9 for all nine (floor(span / 2) + 5).
 * - Custom: any 3 or more of the seven clues.
 *
 * The daily offers Classic and Squirdle-style, each one shared puzzle with
 * fixed rules (all generations, the format's guesses, no timer); only the
 * Pokédex level and hard mode are the player's there, as before.
 */

export const DLE_FORMATS = ["classic", "squirdle", "custom"] as const;
export type DleFormat = (typeof DLE_FORMATS)[number];
export const DLE_DAILY_FORMATS = ["classic", "squirdle"] as const;
export type DleDailyFormat = (typeof DLE_DAILY_FORMATS)[number];
export const isDleFormat = (v: unknown): v is DleFormat => typeof v === "string" && (DLE_FORMATS as readonly string[]).includes(v);
export const isDailyFormat = (v: unknown): v is DleDailyFormat => v === "classic" || v === "squirdle";

export const DLE_FORMAT_LABEL: Record<DleFormat, string> = { classic: "Classic", squirdle: "Squirdle", custom: "Custom" };
export const DLE_FORMAT_BLURB: Record<DleFormat, string> = {
  classic: "Seven clues, with close states (yellow) for near misses.",
  squirdle: "Gen, types, height and weight with ▲ / ▼ only, like Squirdle. Guesses scale with the generation range.",
  custom: "Pick the clue columns you want (3 or more).",
};

/** The generations there are (the Pokédex's MAX_GEN; checked in the tests). */
export const DLE_GEN_COUNT = 9;
export const DLE_GUESS_CHOICES = [6, 8, 10] as const;
export const DLE_TIMERS = ["none", "3m", "60s"] as const;
export type DleTimer = (typeof DLE_TIMERS)[number];
export const DLE_TIMER_MS: Record<DleTimer, number> = { none: 0, "3m": 180_000, "60s": 60_000 };
export const DLE_TIMER_LABEL: Record<DleTimer, string> = { none: "No timer", "3m": "3 min", "60s": "60 s blitz" };
export const DLE_POOLS = ["all", "legendary"] as const;
export type DlePool = (typeof DLE_POOLS)[number];

export const SQUIRDLE_COLUMNS: readonly DleColumn[] = ["gen", "type1", "type2", "height", "weight"];
export const DLE_ALL_COLUMNS: readonly DleColumn[] = DLE_COLUMNS.map((c) => c.key);
export const DLE_MIN_COLUMNS = 3;

/** Squirdle's guess count for a generation range: floor(span / 2) + 5 (5 for Gen 1 only, 9 for all nine). */
export const squirdleGuesses = (min: number, max: number) => Math.floor((max - min) / 2) + 5;

/** What a player picks (kept on this device), and what a practice game or duel sends. Anything here may be missing or wrong: see dleRules. */
export interface DleSettings {
  format: DleFormat;
  /** Custom only: the clue columns shown. */
  columns: DleColumn[];
  /** The generation range, first to last. */
  gens: [number, number];
  /** 0: the format's own count. */
  guesses: 0 | (typeof DLE_GUESS_CHOICES)[number];
  /** The opt-in hints (category, silhouette). */
  hints: boolean;
  /** Close (yellow) states for numbers. Off: ▲ / ▼ only ("Squirdle strict"). Squirdle-style is always off. */
  close: boolean;
  timer: DleTimer;
  /** Every Pokémon, or legendary and mythical ones only. */
  pool: DlePool;
}

export const DLE_DEFAULT_SETTINGS: DleSettings = {
  format: "classic",
  columns: [...DLE_ALL_COLUMNS],
  gens: [1, DLE_GEN_COUNT],
  guesses: 0,
  hints: true,
  close: true,
  timer: "none",
  pool: "all",
};

/** The rules a game is played by, as the server commits to them. */
export interface DleRules {
  format: DleFormat;
  /** The clue columns shown, in board order. */
  columns: DleColumn[];
  /** The answer's generations, sorted (empty: all). */
  gens: number[];
  maxGuesses: number;
  hints: boolean;
  close: boolean;
  timer: DleTimer;
  pool: DlePool;
}

const int = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);

/** A generation list from a range (all of them: empty). */
export function gensOfRange(min: number, max: number): number[] {
  if (min <= 1 && max >= DLE_GEN_COUNT) return [];
  return Array.from({ length: max - min + 1 }, (_, k) => min + k);
}

/** [first, last] of a generation list (empty: all). */
export const rangeOfGens = (gens: readonly number[]): [number, number] => (gens.length ? [Math.min(...gens), Math.max(...gens)] : [1, DLE_GEN_COUNT]);

/** Cleans up settings from anywhere (local storage, a request) into settings that are all valid. */
export function cleanSettings(raw: unknown): DleSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof DleSettings, unknown>>;
  const d = DLE_DEFAULT_SETTINGS;
  const format = isDleFormat(o.format) ? o.format : d.format;
  const picked = Array.isArray(o.columns) ? DLE_ALL_COLUMNS.filter((c) => (o.columns as unknown[]).includes(c)) : d.columns;
  const columns = picked.length >= DLE_MIN_COLUMNS ? picked : [...d.columns];
  const g = Array.isArray(o.gens) ? o.gens : [];
  let lo = int(g[0], 1, DLE_GEN_COUNT, 1);
  let hi = int(g[1], 1, DLE_GEN_COUNT, DLE_GEN_COUNT);
  if (lo > hi) [lo, hi] = [hi, lo];
  const guesses = (DLE_GUESS_CHOICES as readonly unknown[]).includes(o.guesses) ? (o.guesses as DleSettings["guesses"]) : 0;
  return {
    format,
    columns,
    gens: [lo, hi],
    guesses,
    hints: o.hints !== false,
    close: o.close !== false,
    timer: (DLE_TIMERS as readonly unknown[]).includes(o.timer) ? (o.timer as DleTimer) : "none",
    pool: o.pool === "legendary" ? "legendary" : "all",
  };
}

/** The rules a set of settings (cleaned first) plays by. */
export function dleRules(raw: unknown): DleRules {
  const s = cleanSettings(raw);
  const [lo, hi] = s.gens;
  const squirdle = s.format === "squirdle";
  const columns = squirdle ? [...SQUIRDLE_COLUMNS] : s.format === "custom" ? s.columns : [...DLE_ALL_COLUMNS];
  const ownGuesses = squirdle ? squirdleGuesses(lo, hi) : DLE_MAX_GUESSES;
  return {
    format: s.format,
    columns,
    gens: gensOfRange(lo, hi),
    maxGuesses: s.guesses || ownGuesses,
    hints: s.hints,
    close: squirdle ? false : s.close,
    timer: s.timer,
    pool: s.pool,
  };
}

/** The daily's rules: the format's own, over every generation, with hints and no timer. */
export const dailyRules = (format: DleDailyFormat): DleRules => dleRules({ format });

export const CLASSIC_RULES: DleRules = dailyRules("classic");

/** The settings that give these rules (for a rules object to travel as settings). */
export function settingsOf(rules: DleRules): DleSettings {
  const [lo, hi] = rangeOfGens(rules.gens);
  const own = rules.format === "squirdle" ? squirdleGuesses(lo, hi) : DLE_MAX_GUESSES;
  const guesses = rules.maxGuesses === own ? 0 : ((DLE_GUESS_CHOICES as readonly number[]).includes(rules.maxGuesses) ? rules.maxGuesses : 0) as DleSettings["guesses"];
  return { format: rules.format, columns: [...rules.columns], gens: [lo, hi], guesses, hints: rules.hints, close: rules.close, timer: rules.timer, pool: rules.pool };
}

/** With close states off, a close clue reads as the plain arrow. */
export function strictStatus(status: CellStatus, close: boolean): CellStatus {
  if (close) return status;
  return status === "close-higher" ? "higher" : status === "close-lower" ? "lower" : status;
}

/**
 * The bonus for a harder board, on top of the Pokédex multiplier: +5% for
 * each clue column hidden and +10% without close states, at most +25%.
 * Classic: none; Squirdle-style: +20% (two columns hidden, no close states).
 */
export const DLE_COLUMN_BONUS = 0.05;
export const DLE_STRICT_BONUS = 0.1;
export const DLE_MAX_BONUS = 0.25;

export function rulesBonus(rules: Pick<DleRules, "columns" | "close">): number {
  const raw = (DLE_ALL_COLUMNS.length - rules.columns.length) * DLE_COLUMN_BONUS + (rules.close ? 0 : DLE_STRICT_BONUS);
  return Math.round(Math.min(DLE_MAX_BONUS, raw) * 100) / 100;
}

/** "+20%", or "" for none. */
export const bonusText = (rules: Pick<DleRules, "columns" | "close">) => {
  const b = rulesBonus(rules);
  return b > 0 ? `+${Math.round(b * 100)}%` : "";
};

/** "Gen 1", "Gen 1–4", "All gens". */
export function gensText(gens: readonly number[]): string {
  if (!gens.length) return "All gens";
  const [lo, hi] = rangeOfGens(gens);
  const contiguous = gens.length === hi - lo + 1;
  if (!contiguous) return `Gen ${gens.join(", ")}`;
  return lo === hi ? `Gen ${lo}` : `Gen ${lo}–${hi}`;
}

/**
 * The game's tags, for the summary chip, the result and the share: the
 * format, then whatever differs from it ("Squirdle · Gen 1–4 · 8 guesses ·
 * No dex"). `dex` (the Pokédex level's label) and `hard` are added when given.
 */
export function rulesTags(rules: DleRules, extra: { dex?: string; hard?: boolean } = {}): string[] {
  const tags: string[] = [DLE_FORMAT_LABEL[rules.format]];
  if (rules.format === "custom") tags.push(`${rules.columns.length} clues`);
  if (rules.gens.length) tags.push(gensText(rules.gens));
  tags.push(`${rules.maxGuesses} guesses`);
  if (rules.format !== "squirdle" && !rules.close) tags.push("Strict");
  if (!rules.hints) tags.push("No hints");
  if (rules.timer !== "none") tags.push(DLE_TIMER_LABEL[rules.timer]);
  if (rules.pool === "legendary") tags.push("Legendaries");
  if (extra.dex) tags.push(extra.dex);
  if (extra.hard) tags.push("Hard");
  return tags;
}
