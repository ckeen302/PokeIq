import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { getPokemon } from "@/lib/pokemon/pokedex";
import { isValidDailyDate, LAUNCH_DATE } from "@/lib/daily";
import { DLE_HINT_KINDS, DLE_MAX_GUESSES, type DleHint } from "@/lib/dle-types";
import type { DleDaySummary, DlePersonal } from "@/lib/dle-community";
import { deriveSeed } from "./crypto";
import { evaluate, hardModeError, type DlePuzzle } from "./pokedle";

/**
 * Pokédle community stats: one result per daily puzzle and trainer, and the
 * day's totals ("4,213 trainers played, 91% solved, you're in the top 18%").
 *
 * A result is never taken on the client's word: the client sends its
 * guesses and the server plays them again with evaluate(), so the most a
 * cheat can do is replay a real game. The first result each trainer sends
 * for a day is the one kept. Only the daily puzzle counts (today's, or
 * yesterday's / tomorrow's in another time zone: isValidDailyDate): never
 * practice or the archive.
 *
 * Trainers are anonymous: a random id from the browser (or the signed-in
 * account), stored only as an HMAC.
 *
 * Results live in Supabase (`dle_results`, RLS-locked, service role only),
 * or in memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests and the local E2E run).
 * Without either, or before the migration has been applied, there are no
 * community stats: callers get null and the page shows no panel.
 */

/** What the browser sends to identify a trainer: a random id it keeps. */
export const DLE_PLAYER_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** The day's puzzle, as /api/pokedle plays it. */
export const dailyPuzzle = (date: string): DlePuzzle => ({ id: `daily:${date}` });

/** The key a trainer's results are stored under: an HMAC, never the id itself. */
export const playerKey = (identity: string) => deriveSeed("dle-player", identity);

export interface DleResultRow {
  date: string;
  player: string;
  guesses: number;
  solved: boolean;
  hard: boolean;
  hints: number;
  firstGuess: number;
}

/** What recording a result returns: the row kept, and where it stands. */
export interface RecordedRow {
  recorded: boolean;
  row: Pick<DleResultRow, "guesses" | "solved" | "firstGuess">;
  position: number;
  rank: number | null;
  sameOpener: number;
}

/** The day's totals as the store adds them up. */
export interface RawSummary {
  players: number;
  solved: number;
  /** Solves by guess count. */
  solves: Record<number, number>;
  /** [Pokémon id, trainers] for the most popular openers, most popular first. */
  openers: [number, number][];
}

export interface DleResultStore {
  /** Keeps the first result per day and trainer; returns the row kept. Null when the store isn't there. */
  record(row: DleResultRow): Promise<RecordedRow | null>;
  summary(date: string): Promise<RawSummary | null>;
}

const TOP_OPENERS = 5;

// ---------------------------------------------------------------------------
// In memory (tests, local E2E)
// ---------------------------------------------------------------------------

interface MemoryRow extends DleResultRow {
  seq: number;
}

const globalStore = globalThis as unknown as { __pokeiqDleResults?: { seq: number; days: Map<string, MemoryRow[]> } };

export function memoryResultStore(): DleResultStore {
  const db = (globalStore.__pokeiqDleResults ??= { seq: 0, days: new Map<string, MemoryRow[]>() });
  const dayOf = (date: string) => {
    let rows = db.days.get(date);
    if (!rows) db.days.set(date, (rows = []));
    return rows;
  };
  return {
    async record(row) {
      const day = dayOf(row.date);
      let mine = day.find((r) => r.player === row.player);
      const recorded = !mine;
      if (!mine) day.push((mine = { ...row, seq: ++db.seq }));
      const me = mine;
      return {
        recorded,
        row: { guesses: me.guesses, solved: me.solved, firstGuess: me.firstGuess },
        position: day.filter((r) => r.seq <= me.seq).length,
        rank: me.solved ? day.filter((r) => r.solved && r.seq <= me.seq).length : null,
        sameOpener: day.filter((r) => r.firstGuess === me.firstGuess).length,
      };
    },
    async summary(date) {
      const day = dayOf(date);
      const solves: Record<number, number> = {};
      const openers = new Map<number, number>();
      for (const r of day) {
        if (r.solved) solves[r.guesses] = (solves[r.guesses] ?? 0) + 1;
        openers.set(r.firstGuess, (openers.get(r.firstGuess) ?? 0) + 1);
      }
      return {
        players: day.length,
        solved: day.filter((r) => r.solved).length,
        solves,
        openers: [...openers].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, TOP_OPENERS),
      };
    },
  };
}

/** Forgets every result in memory (tests). */
export function clearMemoryResults() {
  globalStore.__pokeiqDleResults = undefined;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/** The table or its functions aren't there (the migration hasn't been applied). */
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
/** After finding the table missing, look again this much later (so applying the migration needs no redeploy). */
const RECHECK_MS = 60_000;
let missingUntil = 0;

function tableMissing(error: { code?: string; message?: string }): boolean {
  if (!MISSING.has(error.code ?? "")) return false;
  if (Date.now() >= missingUntil) console.warn("[dle-results] community stats are off until migration 0013_dle_results.sql is applied:", error.message);
  missingUntil = Date.now() + RECHECK_MS;
  return true;
}

export function supabaseResultStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): DleResultStore {
  return {
    async record(row) {
      if (Date.now() < missingUntil) return null;
      const { data, error } = await sb.rpc("dle_record_result", {
        p_date: row.date,
        p_player: row.player,
        p_guesses: row.guesses,
        p_solved: row.solved,
        p_hard: row.hard,
        p_hints: row.hints,
        p_first: row.firstGuess,
      });
      if (error) {
        if (tableMissing(error)) return null;
        throw new Error(error.message);
      }
      const r = data as { recorded: boolean; guesses: number; solved: boolean; first_guess: number; position: number; rank: number | null; same_opener: number };
      return {
        recorded: r.recorded,
        row: { guesses: r.guesses, solved: r.solved, firstGuess: r.first_guess },
        position: Number(r.position),
        rank: r.rank === null ? null : Number(r.rank),
        sameOpener: Number(r.same_opener),
      };
    },
    async summary(date) {
      if (Date.now() < missingUntil) return null;
      const { data, error } = await sb.rpc("dle_day_summary", { p_date: date });
      if (error) {
        if (tableMissing(error)) return null;
        throw new Error(error.message);
      }
      const r = data as { players: number; solved: number; solves: Record<string, number>; openers: [number, number][] };
      return {
        players: Number(r.players),
        solved: Number(r.solved),
        solves: Object.fromEntries(Object.entries(r.solves ?? {}).map(([k, n]) => [Number(k), Number(n)])),
        openers: (r.openers ?? []).map(([id, n]) => [Number(id), Number(n)]),
      };
    },
  };
}

/** Where results go: memory for tests and local E2E, else Supabase; null without either. */
export function resultStore(): DleResultStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryResultStore();
  const sb = getServiceSupabase();
  return sb ? supabaseResultStore(sb) : null;
}

// ---------------------------------------------------------------------------
// Results and totals
// ---------------------------------------------------------------------------

export type RecordFailure = { ok: false; status: number; error: string };
const fail = (status: number, error: string): RecordFailure => ({ ok: false, status, error });

export interface ResultInput {
  date: string;
  /** "u:<account id>" or "d:<browser id>". */
  identity: string;
  guesses: number[];
  /** Played in hard mode: kept only if every guess really did fit the clues before it. */
  hard?: boolean;
  /** The hints the trainer opened. */
  hints?: readonly DleHint[];
}

/**
 * Records a finished daily (the first result per trainer and day is kept),
 * after playing its guesses again. Null when community stats are off.
 */
export async function recordDleResult(
  input: ResultInput,
  store: DleResultStore | null = resultStore(),
  now = Date.now()
): Promise<{ ok: true; you: DlePersonal } | RecordFailure | null> {
  if (!isValidDailyDate(input.date, now)) return fail(400, "Only today's Pokédle counts.");
  const puzzle = dailyPuzzle(input.date);
  const result = evaluate(puzzle, input.guesses);
  if (!result.over) return fail(409, "Finish the puzzle first.");
  if (!store) return null;
  const out = await store.record({
    date: input.date,
    player: playerKey(input.identity),
    guesses: result.rows.length,
    solved: result.solved,
    hard: input.hard === true && hardModeError(puzzle, input.guesses) === null,
    hints: DLE_HINT_KINDS.filter((h) => input.hints?.includes(h)).length,
    firstGuess: result.rows[0].id,
  });
  if (!out) return null;
  const first = getPokemon(out.row.firstGuess);
  return {
    ok: true,
    you: {
      recorded: out.recorded,
      guesses: out.row.guesses,
      solved: out.row.solved,
      firstGuess: { id: out.row.firstGuess, name: first?.name ?? `#${out.row.firstGuess}` },
      position: out.position,
      rank: out.rank,
      sameOpener: out.sameOpener,
    },
  };
}

/** A daily that has been out somewhere: from launch day to tomorrow (UTC). */
export function isStatsDate(date: unknown, now = Date.now()): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) return false;
  return date >= LAUNCH_DATE && (isValidDailyDate(date, now) || t < now);
}

/** The day's totals. Null when community stats are off. */
export async function dleDaySummary(date: string, store: DleResultStore | null = resultStore()): Promise<DleDaySummary | null> {
  const raw = store ? await store.summary(date) : null;
  if (!raw) return null;
  const dist = Array.from({ length: DLE_MAX_GUESSES }, (_, k) => raw.solves[k + 1] ?? 0);
  return {
    date,
    players: raw.players,
    solved: raw.solved,
    dist,
    failed: Math.max(0, raw.players - raw.solved),
    openers: raw.openers.map(([id, count]) => ({ id, name: getPokemon(id)?.name ?? `#${id}`, count })),
  };
}
