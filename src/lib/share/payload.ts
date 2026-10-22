import { DIFFICULTIES, FORMATS, MODULES, type Difficulty, type ModuleId, type QuizFormat } from "@/engines/types";
import { DLE_ASSISTS, type DleAssist } from "@/lib/dle-assist";
import type { DleFormat } from "@/lib/dle-format";
import { DLE_HINT_KINDS, type DleHint } from "@/lib/dle-types";
import { GEO_MAP_ORDER, GEO_MAX_ROUND_SCORE, GEO_ROUNDS } from "@/lib/geo-types";
import { CPU_LEVELS, PLAY_FORMAT_INFO, type CpuLevel, type PlayFormatId } from "@/lib/battle/play";

/**
 * A finished game's result as it travels in a share link (/s/<payload>).
 *
 * The payload is plain, unsigned and short: anyone can type one, so it is
 * only ever read back through `decodeShare`, which accepts nothing but known
 * games, enumerated modes and bounded numbers. There is no free text in it at
 * all (no names, no guesses, no answers), so a forged link can claim a score
 * but can't put words on the landing page or its preview card, and a daily's
 * link can never spoil the puzzle.
 *
 * Wire format: `<game>.<k><value>.<k><value>…`, one letter per key and
 * values from [A-Za-z0-9-], e.g. `dle.n123.fc.m8.k5.rgybby-ggggg`.
 */

/**
 * Pokédle's squares, one letter each. Classic (and Custom) boards: g match,
 * y near (partial or close), b wrong. Squirdle-style: c right, u the answer
 * is higher, d lower, p the type in the other slot, x wrong, m the daily's
 * masked generation arrow.
 */
export const DLE_TILE_LETTERS = "gybcudpxm";

export interface PokedleShareResult {
  game: "pokedle";
  /** The daily's number; none for a practice game. */
  daily?: number;
  /** A past daily from the archive. */
  archive?: boolean;
  format: DleFormat;
  /** The game's guesses. */
  max: number;
  solved: boolean;
  hard?: boolean;
  streak?: number;
  assist?: DleAssist;
  hints?: DleHint[];
  /** One string of DLE_TILE_LETTERS per guess, oldest first. */
  rows: string[];
  /** "Top 18% of 4,213 trainers". */
  top?: number;
  players?: number;
}

export interface GuessrShareResult {
  game: "guessr";
  daily?: number;
  /** A map id from GEO_MAP_ORDER ("world", "kanto", …). */
  region: string;
  /** Five-round game: each round's points. */
  rounds?: number[];
  /** Streak mode: places in a row. */
  streak?: number;
}

export interface QuizShareResult {
  game: "quiz";
  module: ModuleId;
  format: QuizFormat;
  difficulty?: Difficulty;
  /** The Daily Challenge's number. */
  daily?: number;
  correct: number;
  total: number;
  pokeiq: number;
  score: number;
  /** Seconds the run took. */
  seconds?: number;
  /** "1" right / "0" wrong per question (the link keeps the first SHARE_QUIZ_GRID). */
  grid: string;
  /** The Daily Challenge streak. */
  streak?: number;
}

export interface BattleShareResult {
  game: "battle";
  format: PlayFormatId;
  outcome: "win" | "loss" | "tie";
  /** Against the computer (at a level) or another trainer. */
  cpu?: CpuLevel;
  ranked?: boolean;
  turns: number;
}

/**
 * A PokéConnections game: each guess as four digits, the group (0 yellow to
 * 3 purple) of each Pokémon picked. Colours only: never a Pokémon or a
 * group's name, so a daily's link can't spoil it.
 */
export interface ConnectionsShareResult {
  game: "connections";
  daily?: number;
  archive?: boolean;
  solved: boolean;
  /** One per guess, oldest first: four of "0123". */
  rows: string[];
  seconds?: number;
  streak?: number;
}

export type ShareResult = PokedleShareResult | GuessrShareResult | QuizShareResult | BattleShareResult | ConnectionsShareResult;
export type ShareGame = ShareResult["game"];

/** Longest payload accepted (and produced). */
export const SHARE_PAYLOAD_MAX = 320;
const SEGMENTS_MAX = 20;
const DLE_MAX_ROWS = 12;
const DLE_MAX_COLUMNS = 7;
export const SHARE_QUIZ_GRID = 60;

const GAME_CODES: Record<ShareGame, string> = { pokedle: "dle", guessr: "geo", quiz: "quiz", battle: "bat", connections: "con" };
/** A PokéConnections game's most guesses: four groups and four mistakes, less the one that ends it. */
const CONN_MAX_ROWS = 7;
const DLE_FORMAT_CODES: Record<DleFormat, string> = { classic: "c", squirdle: "s", custom: "x" };
const DLE_HINT_CODES: Record<DleHint, string> = { genus: "g", silhouette: "s" };
const OUTCOME_CODES = { win: "w", loss: "l", tie: "t" } as const;

/** code -> value, with no prototype: a payload's "constructor" or "toString" finds nothing. */
const invert = <K extends string>(rec: Record<K, string>): Record<string, K | undefined> =>
  Object.assign(Object.create(null) as Record<string, K>, Object.fromEntries(Object.entries(rec).map(([k, v]) => [v, k])));
const GAME_BY_CODE = invert(GAME_CODES);
const DLE_FORMAT_BY_CODE = invert(DLE_FORMAT_CODES);
const DLE_HINT_BY_CODE = invert(DLE_HINT_CODES);
const OUTCOME_BY_CODE = invert(OUTCOME_CODES);

const int = (n: number) => String(Math.max(0, Math.round(n)));

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** The result as a URL path segment (see the wire format above). */
export function encodeShare(result: ShareResult): string {
  const fields: [string, string | number | boolean | undefined][] = [];
  switch (result.game) {
    case "pokedle":
      fields.push(
        ["n", result.daily],
        ["a", result.archive],
        ["f", DLE_FORMAT_CODES[result.format]],
        ["m", result.max],
        ["w", result.solved ? 1 : 0],
        ["h", result.hard],
        ["k", result.streak || undefined],
        ["l", result.assist],
        ["i", result.hints?.length ? result.hints.map((h) => DLE_HINT_CODES[h]).join("") : undefined],
        ["t", result.top],
        ["y", result.players],
        ["r", result.rows.slice(0, DLE_MAX_ROWS).map((r) => r.slice(0, DLE_MAX_COLUMNS)).join("-")]
      );
      break;
    case "guessr":
      fields.push(["n", result.daily], ["z", result.region], ["s", result.streak], ["r", result.rounds?.map(int).join("-")]);
      break;
    case "quiz":
      fields.push(
        ["o", result.module],
        ["f", result.format],
        ["d", result.difficulty],
        ["n", result.daily],
        ["c", result.correct],
        ["t", result.total],
        ["q", result.pokeiq],
        ["s", result.score],
        ["e", result.seconds],
        ["k", result.streak || undefined],
        ["r", result.grid.slice(0, SHARE_QUIZ_GRID)]
      );
      break;
    case "battle":
      fields.push(["f", result.format], ["o", OUTCOME_CODES[result.outcome]], ["l", result.cpu], ["k", result.ranked], ["t", result.turns]);
      break;
    case "connections":
      fields.push(
        ["n", result.daily],
        ["a", result.archive],
        ["w", result.solved ? 1 : 0],
        ["k", result.streak || undefined],
        ["e", result.seconds],
        ["r", result.rows.slice(0, CONN_MAX_ROWS).join("-")]
      );
      break;
  }
  const parts = [GAME_CODES[result.game]];
  for (const [key, value] of fields) {
    if (value === undefined || value === false || value === "") continue;
    parts.push(`${key}${value === true ? 1 : typeof value === "number" ? int(value) : value}`);
  }
  return parts.join(".").slice(0, SHARE_PAYLOAD_MAX);
}

/** The share link's path: /s/<payload>. */
export const sharePath = (result: ShareResult) => `/s/${encodeShare(result)}`;

// ---------------------------------------------------------------------------
// Decoding: never trusts the input
// ---------------------------------------------------------------------------

const PAYLOAD_RE = /^[a-z]{2,4}(\.[a-z][A-Za-z0-9-]{0,100})*$/;

/** A whole number in [min, max], or undefined (absent or out of range). */
function num(raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
}

const oneOf = <T extends string>(list: readonly T[], raw: string | undefined): T | undefined =>
  raw !== undefined && (list as readonly string[]).includes(raw) ? (raw as T) : undefined;

/**
 * Reads a payload back, or null when it is anything but a well-formed
 * result: too long, unknown game, a mode or number out of range, a board
 * that doesn't add up. Unknown keys are ignored (older or newer links).
 */
export function decodeShare(raw: unknown): ShareResult | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > SHARE_PAYLOAD_MAX) return null;
  if (!PAYLOAD_RE.test(raw)) return null;
  const [code, ...segments] = raw.split(".");
  if (segments.length > SEGMENTS_MAX) return null;
  const game = GAME_BY_CODE[code];
  if (!game) return null;
  const f = Object.create(null) as Record<string, string>;
  for (const s of segments) {
    if (s[0] in f) return null; // a key twice: not something encodeShare writes
    f[s[0]] = s.slice(1);
  }
  switch (game) {
    case "pokedle":
      return decodePokedle(f);
    case "guessr":
      return decodeGuessr(f);
    case "quiz":
      return decodeQuiz(f);
    case "battle":
      return decodeBattle(f);
    case "connections":
      return decodeConnections(f);
  }
}

/** A row that's one whole group: a right guess. */
const isGroupRow = (row: string) => /^([0-3])\1{3}$/.test(row);

function decodeConnections(f: Record<string, string>): ConnectionsShareResult | null {
  const solved = f.w === "1" ? true : f.w === "0" ? false : undefined;
  if (solved === undefined || !f.r) return null;
  const rows = f.r.split("-");
  if (rows.length > CONN_MAX_ROWS || rows.some((r) => !/^[0-3]{4}$/.test(r))) return null;
  const found = rows.filter(isGroupRow);
  const mistakes = rows.length - found.length;
  // A real game: each group found once, at most four mistakes, and it ends on the guess that finished it.
  if (new Set(found).size !== found.length || mistakes > 4) return null;
  if (solved ? found.length !== 4 || !isGroupRow(rows[rows.length - 1]) : mistakes !== 4 || isGroupRow(rows[rows.length - 1])) return null;
  const daily = num(f.n, 1, DAILY_MAX);
  const seconds = num(f.e, 1, 86_400);
  const streak = num(f.k, 1, 100_000);
  const archive = daily !== undefined && f.a === "1";
  return {
    game: "connections",
    ...(daily !== undefined && { daily }),
    ...(archive && { archive: true }),
    solved,
    rows,
    ...(seconds !== undefined && { seconds }),
    ...(streak !== undefined && daily !== undefined && !archive && { streak }),
  };
}

const DAILY_MAX = 100_000;

function decodePokedle(f: Record<string, string>): PokedleShareResult | null {
  const format = DLE_FORMAT_BY_CODE[f.f ?? ""];
  const max = num(f.m, 1, DLE_MAX_ROWS);
  const solved = f.w === "1" ? true : f.w === "0" ? false : undefined;
  if (!format || max === undefined || solved === undefined || !f.r) return null;
  const rows = f.r.split("-");
  const letters = format === "squirdle" ? /^[cudpxm]+$/ : /^[gyb]+$/;
  if (rows.length > max || rows.some((r) => r.length < 1 || r.length > DLE_MAX_COLUMNS || !letters.test(r))) return null;
  if (rows.some((r) => r.length !== rows[0].length)) return null;
  const won = format === "squirdle" ? /^c+$/ : /^g+$/;
  // A solve ends on an all-right row (a wrong guess can look all right too: two Pokémon can share every clue).
  if (solved && !won.test(rows[rows.length - 1])) return null;
  const daily = num(f.n, 1, DAILY_MAX);
  const hints = f.i ? [...f.i].map((c) => DLE_HINT_BY_CODE[c]) : [];
  if (hints.some((h) => !h) || new Set(hints).size !== hints.length || hints.length > DLE_HINT_KINDS.length) return null;
  const top = num(f.t, 1, 100);
  const players = num(f.y, 2, 10_000_000);
  return {
    game: "pokedle",
    ...(daily !== undefined && { daily }),
    ...(daily !== undefined && f.a === "1" && { archive: true }),
    format,
    max,
    solved,
    ...(f.h === "1" && { hard: true }),
    ...(num(f.k, 1, 100_000) !== undefined && daily !== undefined && f.a !== "1" && { streak: num(f.k, 1, 100_000) }),
    ...(oneOf(DLE_ASSISTS, f.l) && { assist: oneOf(DLE_ASSISTS, f.l) }),
    ...(hints.length > 0 && { hints: DLE_HINT_KINDS.filter((h) => hints.includes(h)) }),
    rows,
    ...(top !== undefined && players !== undefined && { top, players }),
  };
}

function decodeGuessr(f: Record<string, string>): GuessrShareResult | null {
  const region = oneOf(GEO_MAP_ORDER, f.z);
  if (!region) return null;
  const daily = num(f.n, 1, DAILY_MAX);
  if (f.s !== undefined) {
    const streak = num(f.s, 0, 10_000);
    return streak === undefined ? null : { game: "guessr", ...(daily !== undefined && { daily }), region, streak };
  }
  const rounds = (f.r ?? "").split("-").map((r) => num(r, 0, GEO_MAX_ROUND_SCORE));
  if (rounds.length !== GEO_ROUNDS || rounds.some((r) => r === undefined)) return null;
  return { game: "guessr", ...(daily !== undefined && { daily }), region, rounds: rounds as number[] };
}

function decodeQuiz(f: Record<string, string>): QuizShareResult | null {
  const mode = oneOf(MODULES, f.o);
  const format = oneOf(FORMATS, f.f);
  const total = num(f.t, 1, 1000);
  const correct = num(f.c, 0, total ?? 0);
  const pokeiq = num(f.q, 0, 300);
  const score = num(f.s, 0, 10_000_000);
  const grid = f.r ?? "";
  if (!mode || !format || total === undefined || correct === undefined || pokeiq === undefined || score === undefined) return null;
  if (!/^[01]*$/.test(grid) || grid.length > Math.min(total, SHARE_QUIZ_GRID)) return null;
  const daily = num(f.n, 1, DAILY_MAX);
  const seconds = num(f.e, 0, 86_400);
  const streak = num(f.k, 1, 100_000);
  const difficulty = oneOf(DIFFICULTIES, f.d);
  return {
    game: "quiz",
    module: mode,
    format,
    ...(difficulty && { difficulty }),
    ...(daily !== undefined && { daily }),
    correct,
    total,
    pokeiq,
    score,
    ...(seconds !== undefined && { seconds }),
    grid,
    ...(streak !== undefined && daily !== undefined && { streak }),
  };
}

function decodeBattle(f: Record<string, string>): BattleShareResult | null {
  const format = f.f && Object.prototype.hasOwnProperty.call(PLAY_FORMAT_INFO, f.f) ? (f.f as PlayFormatId) : undefined;
  const outcome = OUTCOME_BY_CODE[f.o ?? ""];
  const turns = num(f.t, 0, 10_000);
  if (!format || !outcome || turns === undefined) return null;
  const cpu = oneOf(CPU_LEVELS, f.l);
  return { game: "battle", format, outcome, ...(cpu && { cpu }), ...(f.k === "1" && !cpu && { ranked: true }), turns };
}
