/**
 * PokéConnections, client-safe: the rules, the daily calendar, the colours
 * and what the API sends. The puzzles and their answers live server-side
 * only (src/lib/server/connections.ts).
 */

/** Wrong guesses allowed: the fourth one ends the game. */
export const CONN_MAX_MISTAKES = 4;
export const CONN_GROUPS = 4;
export const CONN_GROUP_SIZE = 4;

/** The first daily: #1. */
export const CONN_LAUNCH_DATE = "2026-10-22";
const DAY_MS = 86_400_000;
const utcMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(date: unknown): date is string {
  if (typeof date !== "string" || !DATE_RE.test(date)) return false;
  const t = utcMidnight(date);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date;
}

/** The daily's number: #1 on launch day. */
export function connNumber(date: string): number {
  return Math.round((utcMidnight(date) - utcMidnight(CONN_LAUNCH_DATE)) / DAY_MS) + 1;
}

/** Any daily from launch to today, wherever the player is (the archive's too). */
export function isPlayableConnDate(date: unknown, now = Date.now()): date is string {
  if (!isRealDate(date)) return false;
  const t = utcMidnight(date);
  return t >= utcMidnight(CONN_LAUNCH_DATE) && t <= utcMidnight(new Date(now).toISOString().slice(0, 10)) + DAY_MS;
}

/** Today's daily in some time zone (within a day of UTC's): the only one that counts for the day's stats. */
export function isCurrentConnDate(date: unknown, now = Date.now()): date is string {
  if (!isPlayableConnDate(date, now)) return false;
  return Math.abs(utcMidnight(date) - utcMidnight(new Date(now).toISOString().slice(0, 10))) <= DAY_MS;
}

/**
 * The four difficulty levels, easiest first, with a symbol each so a group
 * never relies on colour alone.
 */
export const CONN_LEVELS = [
  { name: "Yellow", emoji: "🟨", symbol: "●", hex: "#f2cf55", hint: "Straightforward" },
  { name: "Green", emoji: "🟩", symbol: "▲", hex: "#96c860", hint: "" },
  { name: "Blue", emoji: "🟦", symbol: "■", hex: "#8fb2ef", hint: "" },
  { name: "Purple", emoji: "🟪", symbol: "◆", hex: "#bd8ad8", hint: "Tricky" },
] as const;

export type ConnLevel = 0 | 1 | 2 | 3;

/** A tile: a Pokémon's id and name (the sprite comes from /api/art). */
export interface ConnTile {
  id: number;
  name: string;
}

/** GET /api/connections: the puzzle's tiles, never its groups. */
export interface ConnPuzzleResponse {
  /** "daily:2026-10-22" or "practice:<seed>". */
  key: string;
  /** The daily's number (none for practice). */
  number?: number;
  tiles: ConnTile[];
  /** A daily only: the server's signed note of when it dealt the tiles, which times the game for the leaderboard. */
  start?: string;
}

export type ConnGuessKind = "correct" | "one-away" | "wrong" | "repeat";

/** A found (or, at the end, revealed) group. */
export interface ConnGroupReveal {
  level: ConnLevel;
  label: string;
  members: ConnTile[];
}

/** The full story of a group, for the "Why?" panel once the game is over. */
export interface ConnGroupExplained extends ConnGroupReveal {
  rule: string;
  /** "Bronzong: Ability Levitate". */
  lines: (ConnTile & { why: string })[];
  /** Pokémon from other groups that looked like they belonged here, and why they don't. */
  herrings: (ConnTile & { reason: string })[];
}

/** POST /api/connections: every guess so far, played again. */
export interface ConnGuessResponse {
  /** One per guess sent, in order. */
  results: { kind: ConnGuessKind; level?: ConnLevel }[];
  /** The groups found, in the order they were found. */
  found: ConnGroupReveal[];
  mistakes: number;
  over: boolean;
  won: boolean;
  /** Once it's over: all four groups, easiest first, explained. */
  reveal?: ConnGroupExplained[];
}

/** POST /api/connections/result: how everyone did on today's daily (absent when stats are off). */
export interface ConnDaySummary {
  players: number;
  solved: number;
  perfect: number;
}

/** Where a finished daily stands on the leaderboard: its place, or why it isn't on it. */
export type ConnBoardStanding = { position: number; total: number; name: string } | { unranked: "no-name" | "unsolved" | "untimed" | "name-taken" | "off" };

export type ConnResultResponse = ({ available: false } | { available: true; summary: ConnDaySummary }) & {
  board?: ConnBoardStanding;
  /** Today's players who found each group (index = level), counted from the server's own replays. */
  groups?: { players: number; pct: [number, number, number, number] };
  /** The server recorded a hint for this game. */
  hinted?: boolean;
  /** Your ranked result, for comparing with a friend's. */
  mine?: { mistakes: number; ms: number; hinted: boolean };
};

/** One line of the daily leaderboard: fewest mistakes, then fastest. */
export interface ConnBoardRow {
  name: string;
  mistakes: number;
  /** From the server dealing the tiles to the finished game reaching it. */
  ms: number;
  /** Played with the hint: ranked below every hint-free game. */
  hinted?: boolean;
}

/** GET /api/connections/leaderboard?date=…: the day's top trainers (null rows: the board is off). */
export interface ConnBoardResponse {
  date: string;
  rows: ConnBoardRow[] | null;
}

/** "a,b,c,d" for a guess, order-free: how repeats are spotted. */
export const guessKey = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join(",");
