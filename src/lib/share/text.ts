import { DLE_HINT_EMOJI, DLE_HINT_KINDS, DLE_MAX_GUESSES, isNear, type CellStatus, type DleHint } from "@/lib/dle-types";
import { DLE_ASSIST_INFO, type DleAssist } from "@/lib/dle-assist";
import type { DleFormat } from "@/lib/dle-format";
import { FORMAT_INFO, MODULE_INFO } from "@/lib/modes";
import { GEO_MAX_ROUND_SCORE, GEO_ROUNDS, WORLD_REGION } from "@/lib/geo-types";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { rarityLines } from "@/lib/pikadoku/share";
import type { BattleShareResult, ConnectionsShareResult, GuessrShareResult, PikadokuShareResult, PokedleShareResult, QuizShareResult } from "./payload";

/**
 * Every game's share text, built the same way (`composeShare`):
 *
 *   PokéIQ <game and puzzle> <score> <badges>
 *   <a few lines of emoji: the board, rounds or answers>
 *   https://pokeiq.vercel.app/s/…
 *
 * The link keeps its https:// so Discord, Reddit and X turn it into a link
 * with a preview card. Daily puzzles share colours and numbers only, never a
 * guess or an answer.
 */

export const SHARE_BRAND = "PokéIQ";

export interface ShareParts {
  /** After "PokéIQ": "Pokédle #142", "PokéGuessr Daily #12 · World". */
  title: string;
  /** "4/8", "18,240/25,000". */
  score?: string;
  /** Short markers after the score: "🔥5", "⏱0:42". */
  badges?: (string | false | null | undefined)[];
  lines?: (string | false | null | undefined)[];
  url?: string;
}

export function composeShare({ title, score, badges = [], lines = [], url }: ShareParts): string {
  const header = [`${SHARE_BRAND} ${title}`, score, ...badges].filter(Boolean).join(" ");
  return [header, ...lines, url].filter(Boolean).join("\n");
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** 75 seconds -> "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Spoiler-free right/wrong grid, wrapped every 10 answers. */
export function emojiGrid(grid: string, perRow = 10): string {
  const cells = [...grid].map((c) => (c === "1" ? "🟩" : "🟥"));
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow).join(""));
  return rows.join("\n");
}

// ---------------------------------------------------------------------------
// Pokédle
// ---------------------------------------------------------------------------

/**
 * Pokédle's share: the puzzle number, guesses (X for a miss), `*` for hard
 * mode, the Pokédex assist level's marker (🧠 off, 📓 notebook, 🔎 field
 * guide, 📚 full), a marker per hint used, the play streak, one square per
 * clue (exact, partial or close, wrong: arrows would break the gradient), an
 * optional line on how the player did against everyone else, and the link.
 * It's built from colours only, so it can never name a guess or the answer.
 */
export interface PokedleShareInput {
  /** The daily's number; none for a practice game. */
  number?: number;
  /** The game's guesses (Classic's 8 when absent). */
  max?: number;
  /** The format and settings tags (rulesTags), after the number: "Pokédle #142 · Squirdle 4/9". */
  tags?: readonly string[];
  /** Squirdle's own symbols: ✅ 🔼 🔽 🟨 ❌, with the generation column's arrow masked as 🟦 on a daily, as Squirdle does (it gives the answer's era away). */
  squirdle?: boolean;
  /** Each guess's clues, oldest first, in board order (the generation first when shown). */
  rows: CellStatus[][];
  solved: boolean;
  hard: boolean;
  hints: readonly DleHint[];
  /** The Pokédex assist level (none: no marker). */
  assist?: DleAssist;
  /** The play streak (0: none shown). */
  streak: number;
  /** The share link (see sharePath), printed as given. */
  url: string;
  /** Orange and blue squares in place of green and yellow. */
  colourBlind?: boolean;
  /** A past daily played from the archive: marked, and no streak. */
  archive?: boolean;
  /** Percentile: the share of the day's players this result beat or tied (0–100), and how many played. */
  community?: { percentile: number; players: number };
  /** The format, for the link's payload (Squirdle when `squirdle`, else Classic). */
  format?: DleFormat;
}

const PALETTE = { normal: { match: "🟩", near: "🟨" }, colourBlind: { match: "🟧", near: "🟦" } };

export function shareSquare(status: CellStatus, colourBlind = false): string {
  const p = colourBlind ? PALETTE.colourBlind : PALETTE.normal;
  return status === "match" ? p.match : isNear(status) ? p.near : "⬛";
}

/** "https://pokeiq.app/pokedle?x=1" -> "pokeiq.app/pokedle". */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/\/$/, "");
}

/** Squirdle's share symbols (its game.js): ✅ right, 🔼 / 🔽 the answer is higher / lower, 🟨 the type in the other slot, ❌ wrong. */
export function squirdleSymbol(status: CellStatus): string {
  return SQUIRDLE_EMOJI[squirdleLetter(status)];
}

function squirdleLetter(status: CellStatus): "c" | "p" | "u" | "d" | "x" {
  if (status === "match") return "c";
  if (status === "partial") return "p";
  if (status === "higher" || status === "close-higher") return "u";
  if (status === "lower" || status === "close-lower") return "d";
  return "x";
}

const SQUIRDLE_EMOJI = { c: "✅", p: "🟨", u: "🔼", d: "🔽", x: "❌", m: "🟦" } as const;

/** A guess's squares as the link's tile letters (see DLE_TILE_LETTERS). */
function tileLetters(row: CellStatus[], squirdle: boolean, maskGen: boolean): string {
  return row
    .map((s, i) => (squirdle ? (maskGen && i === 0 && s !== "match" ? "m" : squirdleLetter(s)) : s === "match" ? "g" : isNear(s) ? "y" : "b"))
    .join("");
}

/** Top x% of the day's players, from a percentile beaten or tied. */
const topPercent = (percentile: number) => Math.min(100, Math.max(1, Math.ceil(100 - percentile)));

/** What a Pokédle share link carries: the same board, as tile letters. */
export function pokedleShareResult(input: Omit<PokedleShareInput, "url">): PokedleShareResult {
  const daily = input.number !== undefined;
  const squirdle = Boolean(input.squirdle);
  const c = input.community;
  return {
    game: "pokedle",
    ...(daily && { daily: input.number }),
    ...(daily && input.archive && { archive: true }),
    format: input.format ?? (squirdle ? "squirdle" : "classic"),
    max: input.max ?? DLE_MAX_GUESSES,
    solved: input.solved,
    ...(input.hard && { hard: true }),
    ...(daily && !input.archive && input.streak > 0 && { streak: input.streak }),
    ...(input.assist && { assist: input.assist }),
    ...(input.hints.length > 0 && { hints: DLE_HINT_KINDS.filter((h) => input.hints.includes(h)) }),
    rows: input.rows.map((r) => tileLetters(r, squirdle, daily)),
    ...(c && c.players > 1 && Number.isFinite(c.percentile) && { top: topPercent(c.percentile), players: c.players }),
  };
}

export function buildPokedleShare(input: PokedleShareInput): string {
  const score = `${input.solved ? input.rows.length : "X"}/${input.max ?? DLE_MAX_GUESSES}${input.hard ? "*" : ""}`;
  const hints = DLE_HINT_KINDS.filter((h) => input.hints.includes(h))
    .map((h) => DLE_HINT_EMOJI[h])
    .join("");
  const daily = input.number !== undefined;
  const title = [daily ? `Pokédle #${input.number}${input.archive ? " (archive)" : ""}` : "Pokédle Practice", ...(input.tags ?? [])].join(" · ");
  const grid = input.rows.map((row) =>
    input.squirdle
      ? [...tileLetters(row, true, daily)].map((l) => SQUIRDLE_EMOJI[l as keyof typeof SQUIRDLE_EMOJI]).join("")
      : row.map((s) => shareSquare(s, input.colourBlind)).join("")
  );
  const c = input.community;
  return composeShare({
    title,
    score,
    badges: [input.assist && DLE_ASSIST_INFO[input.assist].emoji, hints, daily && !input.archive && input.streak > 0 && `🔥${input.streak}`],
    lines: [...grid, c && c.players > 1 && Number.isFinite(c.percentile) && `Top ${topPercent(c.percentile)}% of ${fmt(c.players)} trainers`],
    url: input.url,
  });
}

// ---------------------------------------------------------------------------
// PokéGuessr
// ---------------------------------------------------------------------------

/** A round's square: green near-perfect, yellow close, orange far, red nowhere. */
export function guessrSquare(points: number): string {
  if (points >= 4000) return "🟩";
  if (points >= 2000) return "🟨";
  if (points > 0) return "🟧";
  return "🟥";
}

/** "PokéGuessr Daily #12 · World", "PokéGuessr Kanto Streak". */
export function guessrTitle(r: Pick<GuessrShareResult, "daily" | "region" | "streak">, regionName: string): string {
  const map = r.region === WORLD_REGION ? "World" : regionName;
  if (r.daily !== undefined) return `PokéGuessr Daily #${r.daily} · ${map}`;
  return `PokéGuessr ${map}${r.streak !== undefined ? " Streak" : ""}`;
}

/**
 * Five rounds: total out of 25,000, a square per round and each round's
 * points. Streak mode: how many places in a row. Never a place's name.
 */
export function guessrShareText(r: GuessrShareResult, regionName: string, url?: string): string {
  const title = guessrTitle(r, regionName);
  if (r.streak !== undefined) {
    return composeShare({ title, score: `🔥${r.streak} in a row`, lines: [`${"✅".repeat(Math.min(r.streak, 20))}${r.streak > 20 ? "…" : ""}❌`], url });
  }
  const rounds = r.rounds ?? [];
  const total = rounds.reduce((s, p) => s + p, 0);
  return composeShare({
    title,
    score: `${fmt(total)}/${fmt((rounds.length || GEO_ROUNDS) * GEO_MAX_ROUND_SCORE)}`,
    lines: [rounds.map(guessrSquare).join(""), rounds.map(fmt).join(" · ")],
    url,
  });
}

// ---------------------------------------------------------------------------
// Quizzes, the Daily Challenge and the PokéIQ Test
// ---------------------------------------------------------------------------

const DIFFICULTY_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

/** "Daily #12", "Test", "Who's That Pokémon? · Blitz · Hard". */
export function quizTitle(r: Pick<QuizShareResult, "daily" | "format" | "module" | "difficulty">): string {
  if (r.daily !== undefined) return `Daily #${r.daily}`;
  if (r.format === "adaptive") return "Test";
  return [MODULE_INFO[r.module].title, FORMAT_INFO[r.format].title, r.difficulty && DIFFICULTY_LABEL[r.difficulty]].filter(Boolean).join(" · ");
}

/** Score and time up top, the PokéIQ and points, then a square per answer. */
export function quizShareText(r: QuizShareResult, url?: string): string {
  const test = r.format === "adaptive" && r.daily === undefined;
  return composeShare({
    title: quizTitle(r),
    score: test ? `🧠 ${r.pokeiq} · ${r.correct}/${r.total}` : `${r.correct}/${r.total}`,
    badges: [r.streak ? `🔥${r.streak}` : null, r.seconds !== undefined && `⏱${clock(r.seconds)}`],
    lines: [test ? `${fmt(r.score)} pts` : `🧠 PokéIQ ${r.pokeiq} · ${fmt(r.score)} pts`, emojiGrid(r.grid)],
    url,
  });
}

// ---------------------------------------------------------------------------
// PokéConnections
// ---------------------------------------------------------------------------

/** A group level's square: yellow, green, blue, purple (easiest to hardest), as in NYT Connections; red is a 5×5 board's fifth. */
export const CONN_SQUARES = ["🟨", "🟩", "🟦", "🟪", "🟥"] as const;

/** A board's side from its guess rows: 5 for a 5×5 game, else 4. */
export const connSizeOf = (rows: readonly string[]) => (rows[0]?.length === 5 ? 5 : 4);

/** "PokéConnections #12", "PokéConnections Practice", "PokéConnections Practice 5×5". */
export function connectionsTitle(r: Pick<ConnectionsShareResult, "daily" | "archive" | "rows">): string {
  const size = connSizeOf(r.rows) === 5 ? " 5×5" : "";
  return r.daily !== undefined ? `PokéConnections #${r.daily}${r.archive ? " (archive)" : ""}` : `PokéConnections Practice${size}`;
}

/** Mistakes in a game: the guesses that weren't a whole group. */
export const connMistakes = (rows: readonly string[]) => rows.filter((r) => !/^([0-4])\1{3,4}$/.test(r)).length;

/** "Perfect!", "2 mistakes", "Not solved". */
export function connectionsScore(r: Pick<ConnectionsShareResult, "solved" | "rows">): string {
  if (!r.solved) return "Not solved";
  const m = connMistakes(r.rows);
  return m === 0 ? "Perfect!" : `${m} mistake${m === 1 ? "" : "s"}`;
}

/** The guesses as rows of coloured squares (each Pokémon picked, by its group), like NYT's: never a name. */
export function connectionsShareText(r: ConnectionsShareResult, url?: string): string {
  return composeShare({
    title: connectionsTitle(r),
    score: connectionsScore(r),
    badges: [r.streak ? `🔥${r.streak}` : null, r.seconds !== undefined && `⏱${clock(r.seconds)}`, r.hinted && "💡hint"],
    lines: r.rows.map((row) => [...row].map((d) => CONN_SQUARES[Number(d)]).join("")),
    url,
  });
}

// ---------------------------------------------------------------------------
// Pikadoku
// ---------------------------------------------------------------------------

const PDK_DIFF_LABEL = { easy: "Easy", normal: "Normal", expert: "Expert" } as const;

/** "Pikadoku #12 (Normal)", "Pikadoku Weekly #3", "Pikadoku (Unlimited)". */
export function pikadokuTitle(r: Pick<PikadokuShareResult, "daily" | "weekly" | "archive" | "difficulty">): string {
  if (r.weekly !== undefined) return `Pikadoku Weekly #${r.weekly}`;
  if (r.daily !== undefined) return `Pikadoku #${r.daily}${r.archive ? " (archive)" : ""} (${PDK_DIFF_LABEL[r.difficulty]})`;
  return "Pikadoku (Unlimited)";
}

/** Cells filled, out of nine. */
export const pikadokuSolved = (grid: string) => [...grid].filter((c) => c !== "x").length;

/** Nine squares coloured by how rare each pick was (🟪 under 1%, 🟦 under 10%, 🟩 under 25%, 🟨 25%+, ⬛ wrong or empty): never a Pokémon. */
export function pikadokuShareText(r: PikadokuShareResult, url?: string): string {
  return composeShare({
    title: pikadokuTitle(r),
    score: `${pikadokuSolved(r.grid)}/9`,
    badges: [r.score !== undefined && `Score ${r.score}`, r.streak ? `🔥${r.streak}` : null],
    lines: rarityLines(r.grid),
    url,
  });
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

const OUTCOME_TEXT = { win: "🏆 Victory", loss: "Defeat", tie: "Draw" } as const;
const CPU_LABEL = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;

/** "vs the computer (Hard)", "ranked", "vs a trainer". */
export function battleOpponent(r: Pick<BattleShareResult, "cpu" | "ranked">): string {
  if (r.cpu) return `vs CPU (${CPU_LABEL[r.cpu]})`;
  return r.ranked ? "ranked vs a trainer" : "vs a trainer";
}

/** The result, the format, who against and how long it took. */
export function battleShareText(r: BattleShareResult, url?: string, formatName?: string): string {
  return composeShare({
    title: "Battle",
    score: OUTCOME_TEXT[r.outcome],
    lines: [`${formatName ?? PLAY_FORMAT_INFO[r.format].name} · ${battleOpponent(r)} · ${r.turns} turn${r.turns === 1 ? "" : "s"}`],
    url,
  });
}

/** A saved replay: who beat whom (names already on the replay's public page) and where. */
export function replayShareText(result: string, formatName: string, url?: string): string {
  return composeShare({ title: "Battle replay", lines: [`${result} · ${formatName}`, "▶️ Watch it play out:"], url });
}
