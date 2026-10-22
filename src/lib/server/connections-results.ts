import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { isCurrentConnDate, type ConnBoardStanding, type ConnDaySummary } from "@/lib/connections/types";
import { playGuesses } from "@/lib/connections/generator";
import { deriveSeed } from "./crypto";
import { dailyConnPuzzle } from "./connections";
import { connBoardStore, timeFromStart, type ConnBoardStore } from "./connections-board";

/**
 * PokéConnections' daily stats: "71% of trainers solved today's, 18% got
 * it perfect". One row per daily and trainer (the first result sent is
 * kept), and never on the client's word: the server plays the guesses
 * again. Only today's daily counts (in any time zone), never practice or
 * the archive.
 *
 * Results live in Supabase (`connections_results`, migration 0026, RLS-locked,
 * service role only), or in memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests and
 * the local E2E run). Without either, or before the migration is applied,
 * there are no stats: callers get null and the game carries on without them.
 */

export interface ConnResultRow {
  date: string;
  player: string;
  solved: boolean;
  mistakes: number;
}

export interface ConnResultStore {
  /** Keeps the first result per day and trainer; returns the day's totals. Null when the store isn't there. */
  record(row: ConnResultRow): Promise<ConnDaySummary | null>;
}

/** The key a trainer's results are stored under: an HMAC, never the id itself. */
export const connPlayerKey = (identity: string) => deriveSeed("conn-player", identity);

// In memory (tests, local E2E) -------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqConnResults?: Map<string, Map<string, ConnResultRow>> };

export function memoryConnStore(): ConnResultStore {
  const days = (globalStore.__pokeiqConnResults ??= new Map());
  return {
    async record(row) {
      let day = days.get(row.date);
      if (!day) days.set(row.date, (day = new Map()));
      if (!day.has(row.player)) day.set(row.player, row);
      const rows = [...day.values()];
      return { players: rows.length, solved: rows.filter((r) => r.solved).length, perfect: rows.filter((r) => r.solved && r.mistakes === 0).length };
    },
  };
}

export function clearMemoryConnResults() {
  globalStore.__pokeiqConnResults = undefined;
}

// Supabase ---------------------------------------------------------------------

/** The table or its function isn't there (migration 0026 hasn't been applied). */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;

export function supabaseConnStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): ConnResultStore {
  return {
    async record(row) {
      if (Date.now() < missingUntil) return null;
      const { data, error } = await sb.rpc("conn_record_result", { p_date: row.date, p_player: row.player, p_solved: row.solved, p_mistakes: row.mistakes });
      if (error) {
        if (MISSING.has(error.code ?? "")) {
          if (Date.now() >= missingUntil) console.warn("[connections] daily stats are off until migration 0026_connections_results.sql is applied:", error.message);
          missingUntil = Date.now() + RECHECK_MS;
          return null;
        }
        throw new Error(error.message);
      }
      const r = data as { players: number; solved: number; perfect: number };
      return { players: Number(r.players), solved: Number(r.solved), perfect: Number(r.perfect) };
    },
  };
}

export function connResultStore(): ConnResultStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryConnStore();
  const sb = getServiceSupabase();
  return sb ? supabaseConnStore(sb) : null;
}

export type ConnRecordOutcome = { ok: true; summary: ConnDaySummary | null; board: ConnBoardStanding } | { ok: false; status: number; error: string };

export interface ConnResultInput {
  date: string;
  /** "u:<account id>" or "d:<browser id>". */
  identity: string;
  guesses: number[][];
  /** The start token the server signed when it dealt the tiles (startToken). */
  start?: string;
  /** The name to rank under: a signed-in trainer's username, or a checked trainer name. None: not ranked. */
  name?: string | null;
}

/**
 * Records a finished daily after playing its guesses again: the day's stats
 * (`summary`, null when they're off) and, for a named trainer who solved it,
 * the leaderboard. Both from the server's own replay and clock only.
 */
export async function recordConnResult(
  input: ConnResultInput,
  store: ConnResultStore | null = connResultStore(),
  now = Date.now(),
  board: ConnBoardStore | null = connBoardStore()
): Promise<ConnRecordOutcome> {
  if (!isCurrentConnDate(input.date, now)) return { ok: false, status: 400, error: "Only today's PokéConnections counts." };
  let state;
  try {
    state = playGuesses(dailyConnPuzzle(input.date), input.guesses);
  } catch (err) {
    return { ok: false, status: 400, error: (err as Error).message };
  }
  if (!state.over) return { ok: false, status: 409, error: "Finish the puzzle first." };
  const player = connPlayerKey(input.identity);
  const summary = store ? await store.record({ date: input.date, player, solved: state.won, mistakes: state.mistakes }) : null;
  return { ok: true, summary, board: await rankOnBoard(board, input, player, state.won, state.mistakes, now) };
}

async function rankOnBoard(board: ConnBoardStore | null, input: ConnResultInput, player: string, solved: boolean, mistakes: number, now: number): Promise<ConnBoardStanding> {
  if (!board) return { unranked: "off" };
  // Already on today's board (a reload, or a name added afterwards): where they stand.
  const already = await board.standing(input.date, player);
  if (already) return { ...already, name: input.name ?? "" };
  if (!solved) return { unranked: "unsolved" };
  if (!input.name) return { unranked: "no-name" };
  const durationMs = timeFromStart(input.start, input.date, now);
  if (durationMs === null) return { unranked: "untimed" };
  const out = await board.record({ date: input.date, player, name: input.name, mistakes, durationMs });
  if (out === null) return { unranked: "off" };
  if (out === "name-taken") return { unranked: "name-taken" };
  const standing = await board.standing(input.date, player);
  return standing ? { ...standing, name: input.name } : { unranked: "off" };
}
