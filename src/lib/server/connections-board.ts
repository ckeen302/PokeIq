import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { publicName } from "@/lib/name-filter";
import type { ConnBoardRow } from "@/lib/connections/types";
import { signToken, verifyToken } from "./crypto";

/**
 * PokéConnections' daily leaderboard: fewest mistakes, then fastest time,
 * solved games only, one entry per trainer (and per name) a day.
 *
 * Nothing on it comes from the client's word. The mistakes come from the
 * server playing the guesses again (recordConnResult), and the time from
 * the server's own clock: a signed start token minted when the server dealt
 * the day's tiles (startToken), to the moment the finished game reached it.
 * Only signed-in trainers (their username) and named ones (their trainer
 * name) are ranked.
 *
 * Rows live in Supabase (`connections_board`, migration 0028: RLS on, no
 * grants, server only), or in memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests and
 * the local E2E run). Without either, or before the migration, there's no
 * board: callers get null and the game carries on.
 */

export interface ConnBoardEntry {
  date: string;
  /** An HMAC of the trainer's identity (connPlayerKey), never the identity. */
  player: string;
  name: string;
  mistakes: number;
  durationMs: number;
  /** Played with the hint (migration 0030): ranked below every hint-free game. */
  hinted?: boolean;
}

export type ConnBoardRecord = "recorded" | "exists" | "name-taken";

export interface ConnBoardStore {
  /** Keeps the first entry per trainer a day; a name another trainer has today is refused. Null when the store isn't there. */
  record(entry: ConnBoardEntry): Promise<ConnBoardRecord | null>;
  /** The day's board, best first. */
  top(date: string, limit: number): Promise<ConnBoardRow[] | null>;
  /** Where a trainer stands on the day's board (1 = top), and how many are on it; null if they aren't. */
  standing(date: string, player: string): Promise<{ position: number; total: number } | null>;
  /** These trainers' entries for the day (the friends board), best first. */
  byPlayers(date: string, players: string[]): Promise<ConnBoardEntry[]>;
}

type Rankable = Pick<ConnBoardEntry, "mistakes" | "durationMs" | "hinted">;

/** Hint-free games before every hinted one, then fewer mistakes, then the quicker time (then whoever got there first). */
export const better = (a: Rankable, b: Rankable) => Number(!!a.hinted) - Number(!!b.hinted) || a.mistakes - b.mistakes || a.durationMs - b.durationMs;

// ---------------------------------------------------------------------------
// Start tokens: the server's clock, not the client's
// ---------------------------------------------------------------------------

/** Signed when the server deals a daily's tiles: the day and the server time. */
export const startToken = (date: string, now = Date.now()) => signToken("conn-start", { d: date, t: now });

/** A finished game is ranked only within this long of the deal. */
const MAX_GAME_MS = 36 * 60 * 60 * 1000;

/** The time from the deal to `now`, or null if the token isn't the server's for that day. */
export function timeFromStart(token: unknown, date: string, now = Date.now()): number | null {
  const start = verifyToken<{ d: string; t: number }>("conn-start", token);
  if (!start || start.d !== date || typeof start.t !== "number") return null;
  const ms = now - start.t;
  return ms > 0 && ms <= MAX_GAME_MS ? ms : null;
}

// ---------------------------------------------------------------------------
// In memory (tests, local E2E)
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqConnBoard?: Map<string, (ConnBoardEntry & { seq: number })[]> };
let seq = 0;

export function memoryConnBoard(): ConnBoardStore {
  const days = (globalStore.__pokeiqConnBoard ??= new Map<string, (ConnBoardEntry & { seq: number })[]>());
  const day = (date: string) => {
    let rows = days.get(date);
    if (!rows) days.set(date, (rows = []));
    return rows;
  };
  const sorted = (date: string) => [...day(date)].sort((a, b) => better(a, b) || a.seq - b.seq);
  return {
    async record(entry) {
      const rows = day(entry.date);
      if (rows.some((r) => r.player === entry.player)) return "exists";
      if (rows.some((r) => r.name.toLowerCase() === entry.name.toLowerCase())) return "name-taken";
      rows.push({ ...entry, seq: ++seq });
      return "recorded";
    },
    async top(date, limit) {
      return sorted(date)
        .slice(0, limit)
        .map((r) => ({ name: r.name, mistakes: r.mistakes, ms: r.durationMs, ...(r.hinted && { hinted: true }) }));
    },
    async standing(date, player) {
      const rows = sorted(date);
      const at = rows.findIndex((r) => r.player === player);
      return at < 0 ? null : { position: at + 1, total: rows.length };
    },
    async byPlayers(date, players) {
      const want = new Set(players);
      return sorted(date)
        .filter((r) => want.has(r.player))
        .map(({ seq: _seq, ...entry }) => entry);
    },
  };
}

export function clearMemoryConnBoard() {
  globalStore.__pokeiqConnBoard = undefined;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

/** The table isn't there (migration 0028 hasn't been applied). */
const MISSING = new Set(["42P01", "PGRST205"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;

/** The `hinted` column isn't there (migration 0030 hasn't been applied): games are ranked as before, and hinted ones aren't ranked at all. */
let hintedColumn = true;
const NO_COLUMN = "42703";

function missing(error: { code?: string; message?: string }): boolean {
  if (!MISSING.has(error.code ?? "")) return false;
  if (Date.now() >= missingUntil) console.warn("[connections] the leaderboard is off until migration 0028_connections_board.sql is applied:", error.message);
  missingUntil = Date.now() + RECHECK_MS;
  return true;
}

export function supabaseConnBoard(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): ConnBoardStore {
  return {
    async record(entry) {
      if (Date.now() < missingUntil) return null;
      // Without the column a hinted game can't be told apart from a clean one, so it stays off the board.
      if (entry.hinted && !hintedColumn) return null;
      const row: Record<string, unknown> = { puzzle_date: entry.date, player_key: entry.player, player_name: entry.name, mistakes: entry.mistakes, duration_ms: entry.durationMs };
      let { error } = await sb.from("connections_board").insert(hintedColumn ? { ...row, hinted: !!entry.hinted } : row);
      if (error?.code === NO_COLUMN && hintedColumn) {
        hintedColumn = false;
        if (entry.hinted) return null;
        ({ error } = await sb.from("connections_board").insert(row));
      }
      if (!error) return "recorded";
      if (missing(error)) return null;
      // One entry per trainer a day (the primary key), and one per name.
      if (error.code === "23505") return /pkey/.test(error.message) ? "exists" : "name-taken";
      throw new Error(error.message);
    },
    async top(date, limit) {
      if (Date.now() < missingUntil) return null;
      const ask = () => {
        let q = sb.from("connections_board").select(hintedColumn ? "player_name, mistakes, duration_ms, hinted" : "player_name, mistakes, duration_ms").eq("puzzle_date", date);
        if (hintedColumn) q = q.order("hinted", { ascending: true });
        return q.order("mistakes", { ascending: true }).order("duration_ms", { ascending: true }).order("created_at", { ascending: true }).limit(limit);
      };
      let { data, error } = await ask();
      if (error?.code === NO_COLUMN && hintedColumn) {
        hintedColumn = false;
        ({ data, error } = await ask());
      }
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      return (data as unknown as { player_name: string; mistakes: number; duration_ms: number; hinted?: boolean }[]).map((r) => ({
        // Names are checked on the way in; anything older still shows as "Trainer".
        name: publicName(r.player_name),
        mistakes: r.mistakes,
        ms: r.duration_ms,
        ...(r.hinted && { hinted: true }),
      }));
    },
    async standing(date, player) {
      if (Date.now() < missingUntil) return null;
      const { data: mine, error } = await sb
        .from("connections_board")
        .select(hintedColumn ? "mistakes, duration_ms, created_at, hinted" : "mistakes, duration_ms, created_at")
        .eq("puzzle_date", date)
        .eq("player_key", player)
        .maybeSingle();
      if (error?.code === NO_COLUMN && hintedColumn) {
        hintedColumn = false;
        return this.standing(date, player);
      }
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      if (!mine) return null;
      const m = mine as unknown as { mistakes: number; duration_ms: number; created_at: string; hinted?: boolean };
      const count = async (filter: string) => {
        const { count: n, error: e } = await sb.from("connections_board").select("player_key", { count: "exact", head: true }).eq("puzzle_date", date).or(filter);
        if (e) throw new Error(e.message);
        return n ?? 0;
      };
      const [ahead, total] = await Promise.all([
        count(
          m.hinted
            ? `hinted.eq.false,and(hinted.eq.true,mistakes.lt.${m.mistakes}),and(hinted.eq.true,mistakes.eq.${m.mistakes},duration_ms.lt.${m.duration_ms})`
            : `mistakes.lt.${m.mistakes},and(mistakes.eq.${m.mistakes},duration_ms.lt.${m.duration_ms})`
        ),
        count("mistakes.gte.0"),
      ]);
      return { position: ahead + 1, total };
    },
    async byPlayers(date, players) {
      if (Date.now() < missingUntil || !players.length) return [];
      const ask = () => sb.from("connections_board").select(hintedColumn ? "player_key, player_name, mistakes, duration_ms, hinted" : "player_key, player_name, mistakes, duration_ms").eq("puzzle_date", date).in("player_key", players);
      let { data, error } = await ask();
      if (error?.code === NO_COLUMN && hintedColumn) {
        hintedColumn = false;
        ({ data, error } = await ask());
      }
      if (error) {
        if (missing(error)) return [];
        throw new Error(error.message);
      }
      return (data as unknown as { player_key: string; player_name: string; mistakes: number; duration_ms: number; hinted?: boolean }[])
        .map((r) => ({ date, player: r.player_key, name: publicName(r.player_name), mistakes: r.mistakes, durationMs: r.duration_ms, hinted: !!r.hinted }))
        .sort(better);
    },
  };
}

/** Where the board lives: memory for tests and local E2E, else Supabase; null without either. */
export function connBoardStore(): ConnBoardStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryConnBoard();
  const sb = getServiceSupabase();
  return sb ? supabaseConnBoard(sb) : null;
}
