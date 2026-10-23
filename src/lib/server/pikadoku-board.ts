import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { publicName } from "@/lib/name-filter";
import { signToken, verifyToken, deriveSeed } from "./crypto";
import { betterResult, rarityPct, uniquenessScore } from "@/lib/pikadoku/score";
import { PDK_CELLS, type PdkSlot } from "@/lib/pikadoku/types";

/**
 * Pikadoku's recorded answers (for each cell's rarity) and daily board.
 *
 * Everything here comes from the server's own replay of a finished game and
 * its own clock (a signed start token), never from client numbers. Rows live
 * in Supabase (`pikadoku_answers` and `pikadoku_board`, migration 0032: RLS
 * on, no grants, server only), or in memory with POKEIQ_LOCAL_ACCOUNTS=1
 * (tests and the local E2E run). Without either, or before the migration,
 * rarity and the board are simply hidden and the game carries on.
 */

export interface PdkBoardEntry {
  player: string;
  name: string;
  solved: number;
  score: number;
  ms: number;
}
export interface PdkCounts {
  /** Players with an answer in each cell. */
  totals: number[];
  /** Per cell: how many picked each Pokémon. */
  picks: Map<number, number>[];
}
export interface PdkRecordInput {
  date: string;
  difficulty: PdkSlot;
  player: string;
  /** Ranked under this name, or not ranked when null. */
  name: string | null;
  answers: Map<number, number>;
  ms: number | null;
}
export interface PdkStore {
  /** Stores the first game per player and day; false if they had one already. Null when the store isn't there. */
  saveAnswers(input: PdkRecordInput): Promise<boolean | null>;
  counts(date: string, difficulty: PdkSlot): Promise<PdkCounts | null>;
  saveBoard(date: string, difficulty: PdkSlot, entry: PdkBoardEntry): Promise<void>;
  /** The day's board, best first. */
  board(date: string, difficulty: PdkSlot): Promise<PdkBoardEntry[] | null>;
}

export const pdkPlayerKey = (identity: string) => deriveSeed("pdk-player", identity);
export const pdkStartToken = (key: string, now = Date.now()) => signToken("pdk-start", { k: key, t: now });
/** Milliseconds since the server dealt the grid, or null if the token isn't its own. */
export function pdkElapsed(token: unknown, key: string, now = Date.now()): number | null {
  const t = verifyToken<{ k: string; t: number }>("pdk-start", token);
  if (!t || t.k !== key || typeof t.t !== "number") return null;
  const ms = now - t.t;
  return ms > 0 && ms <= 36 * 3_600_000 ? ms : null;
}

// ---------------------------------------------------------------------------
// Pure helpers on the counts
// ---------------------------------------------------------------------------

/** A pick's rarity once the player's own answer is in the counts. */
export const pickPct = (counts: PdkCounts, cell: number, id: number) => rarityPct(counts.picks[cell].get(id) ?? 0, counts.totals[cell]);

/** The uniqueness score of a set of answers, from recorded counts. */
export function scoreAnswers(counts: PdkCounts, answers: ReadonlyMap<number, number>): { score: number; pcts: (number | null)[] } {
  const pcts = Array.from({ length: PDK_CELLS }, (_, cell) => (answers.has(cell) ? pickPct(counts, cell, answers.get(cell)!) : null));
  return { score: uniquenessScore(pcts), pcts };
}

// ---------------------------------------------------------------------------
// In memory
// ---------------------------------------------------------------------------

interface Day {
  answers: Map<string, Map<number, number>>;
  board: Map<string, PdkBoardEntry>;
}
const g = globalThis as unknown as { __pokeiqPdk?: Map<string, Day> };

export function memoryPdkStore(): PdkStore {
  const days = (g.__pokeiqPdk ??= new Map());
  const day = (d: string, df: string) => {
    const k = `${d}|${df}`;
    let x = days.get(k);
    if (!x) days.set(k, (x = { answers: new Map(), board: new Map() }));
    return x;
  };
  return {
    async saveAnswers(i) {
      const d = day(i.date, i.difficulty);
      if (d.answers.has(i.player)) return false;
      d.answers.set(i.player, new Map(i.answers));
      return true;
    },
    async counts(date, difficulty) {
      return tally([...day(date, difficulty).answers.values()].flatMap((m) => [...m].map(([cell, id]) => ({ cell, id }))));
    },
    async saveBoard(date, difficulty, e) {
      const d = day(date, difficulty);
      if (!d.board.has(e.player)) d.board.set(e.player, e);
    },
    async board(date, difficulty) {
      return [...day(date, difficulty).board.values()].sort(betterResult);
    },
  };
}
export function clearMemoryPdk() {
  g.__pokeiqPdk = undefined;
}

function tally(rows: { cell: number; id: number }[]): PdkCounts {
  const out: PdkCounts = { totals: Array(PDK_CELLS).fill(0), picks: Array.from({ length: PDK_CELLS }, () => new Map()) };
  for (const { cell, id } of rows) {
    out.totals[cell]++;
    out.picks[cell].set(id, (out.picks[cell].get(id) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const MISSING = new Set(["42P01", "PGRST205"]);
let missingUntil = 0;
/** The weekly slot is refused by the difficulty check until migration 0033 widens it: the weekly rarity and board are simply off. */
const weeklyUnsupported = (error: { code?: string }, slot: string) => slot === "weekly" && error.code === "23514";
function missing(error: { code?: string; message?: string }) {
  if (!MISSING.has(error.code ?? "")) return false;
  if (Date.now() >= missingUntil) console.warn("[pikadoku] rarity and the board are off until migration 0032_pikadoku.sql is applied:", error.message);
  missingUntil = Date.now() + 60_000;
  return true;
}

export function supabasePdkStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): PdkStore {
  return {
    async saveAnswers(i) {
      if (Date.now() < missingUntil) return null;
      const rows = [...i.answers].map(([cell, id]) => ({ puzzle_date: i.date, difficulty: i.difficulty, player_key: i.player, cell, pokemon_id: id }));
      if (!rows.length) return false;
      const { error } = await sb.from("pikadoku_answers").insert(rows);
      if (!error) return true;
      if (missing(error) || weeklyUnsupported(error, i.difficulty)) return null;
      if (error.code === "23505") return false;
      throw new Error(error.message);
    },
    async counts(date, difficulty) {
      if (Date.now() < missingUntil) return null;
      const { data, error } = await sb.from("pikadoku_answers").select("cell, pokemon_id").eq("puzzle_date", date).eq("difficulty", difficulty).limit(90_000);
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      return tally((data as { cell: number; pokemon_id: number }[]).map((r) => ({ cell: r.cell, id: r.pokemon_id })));
    },
    async saveBoard(date, difficulty, e) {
      if (Date.now() < missingUntil) return;
      const { error } = await sb.from("pikadoku_board").insert({ puzzle_date: date, difficulty, player_key: e.player, player_name: e.name, solved: e.solved, score: e.score, duration_ms: e.ms });
      if (error && !missing(error) && !weeklyUnsupported(error, difficulty) && error.code !== "23505") throw new Error(error.message);
    },
    async board(date, difficulty) {
      if (Date.now() < missingUntil) return null;
      const { data, error } = await sb.from("pikadoku_board").select("player_key, player_name, solved, score, duration_ms").eq("puzzle_date", date).eq("difficulty", difficulty).limit(5000);
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      return (data as { player_key: string; player_name: string; solved: number; score: number; duration_ms: number }[])
        .map((r) => ({ player: r.player_key, name: publicName(r.player_name), solved: r.solved, score: Number(r.score), ms: r.duration_ms }))
        .sort(betterResult);
    },
  };
}

export function pdkStore(): PdkStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryPdkStore();
  const sb = getServiceSupabase();
  return sb ? supabasePdkStore(sb) : null;
}

export interface PdkStanding {
  position: number;
  total: number;
}
export const standingOf = (rows: PdkBoardEntry[], player: string): PdkStanding | null => {
  const at = rows.findIndex((r) => r.player === player);
  return at < 0 ? null : { position: at + 1, total: rows.length };
};
