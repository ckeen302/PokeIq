import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { publicName } from "@/lib/name-filter";
import { deriveSeed, signToken, verifyToken } from "./crypto";
import type { NeaBoard } from "@/lib/name-em-all/types";

/**
 * Name 'em All's ranked boards, one pair per category (and one per daily):
 *
 *   clear  the fastest full clear
 *   count  the most named inside the category's standard time (ties: the
 *          earlier last name)
 *
 * The game runs in the browser (names fill in the instant they're typed),
 * so a finished run is checked here against the server's own clock: a
 * signed start token says when it began, and a run claiming far less time
 * than really passed (paused, or edited) isn't ranked, nor is one named
 * faster than anybody types. Each trainer keeps their best entry (the
 * daily keeps the first).
 *
 * Rows live in Supabase (`name_em_all_board`, migration 0038: RLS on, no
 * grants, server only), or in memory with POKEIQ_LOCAL_ACCOUNTS=1. Without
 * either, or before the migration, the boards are simply hidden.
 */

export interface NeaEntry {
  player: string;
  name: string;
  named: number;
  total: number;
  ms: number;
}

export interface NeaStore {
  /** Keeps the better of this and the trainer's stored entry (the first one, with `firstOnly`). Null when the store isn't there. */
  submit(scope: string, board: NeaBoard, entry: NeaEntry, firstOnly: boolean): Promise<boolean | null>;
  /** The board, best first. */
  board(scope: string, board: NeaBoard): Promise<NeaEntry[] | null>;
  /** One trainer's entries on every scope and board (their personal bests, for the profile). */
  mine(player: string): Promise<NeaOwnEntry[] | null>;
}

export interface NeaOwnEntry extends NeaEntry {
  scope: string;
  board: NeaBoard;
}

export const neaPlayerKey = (identity: string) => deriveSeed("nea-player", identity);

/** Best first: more named, then quicker. */
export const betterEntry = (a: Pick<NeaEntry, "named" | "ms">, b: Pick<NeaEntry, "named" | "ms">) => b.named - a.named || a.ms - b.ms;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

interface StartPayload {
  /** Category (or daily scope). */
  s: string;
  k: string;
  t: number;
}

export const neaStartToken = (scope: string, key: string, now = Date.now()) => signToken("nea-start", { s: scope, k: key, t: now } satisfies StartPayload);

/** Milliseconds since the server started the run, or null if the token isn't its own for this scope and player. */
export function neaElapsed(token: unknown, scope: string, key: string, now = Date.now()): number | null {
  const t = verifyToken<StartPayload>("nea-start", token);
  if (!t || t.s !== scope || t.k !== key || typeof t.t !== "number") return null;
  const ms = now - t.t;
  return ms > 0 && ms <= 6 * 3_600_000 ? ms : null;
}

/** A checked run waiting for a name: posted later with the trainer's name. */
export interface NeaClaim {
  s: string;
  k: string;
  daily: boolean;
  total: number;
  clear: number | null;
  count: { named: number; ms: number } | null;
  t: number;
}
const CLAIM_MS = 60 * 60_000;
export const signClaim = (c: NeaClaim) => signToken("nea-claim", c);
export function readClaim(token: unknown, now = Date.now()): NeaClaim | null {
  const c = verifyToken<NeaClaim>("nea-claim", token);
  return c && typeof c.t === "number" && now - c.t <= CLAIM_MS ? c : null;
}

// ---------------------------------------------------------------------------
// Checking a run
// ---------------------------------------------------------------------------

/** Nobody names Pokémon faster than this on average. */
export const MIN_MS_PER_NAME = 250;
/** Time a finished run may lose between the last name and the result reaching us. */
const SLACK_MS = 15_000;

export interface NeaRunInput {
  total: number;
  /** The category's standard time. */
  limitMs: number;
  named: number[];
  times: number[];
  /** The run's clock at the end. */
  ms: number;
  /** Real time since the server's start token. */
  wallMs: number;
}

export type NeaRunCheck =
  | { ok: true; clear: number | null; count: { named: number; ms: number } | null }
  | { ok: false; reason: string };

/** Checks a finished run and works out what it posts: a clear time, and the names inside the standard time. */
export function checkRun({ total, limitMs, named, times, ms, wallMs }: NeaRunInput): NeaRunCheck {
  if (named.length !== times.length || named.length > total) return { ok: false, reason: "That run doesn't add up." };
  if (new Set(named).size !== named.length || named.some((i) => !Number.isInteger(i) || i < 0 || i >= total)) return { ok: false, reason: "That run doesn't add up." };
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i]) || times[i] < 0 || times[i] > ms + 1000 || (i > 0 && times[i] < times[i - 1])) return { ok: false, reason: "That run doesn't add up." };
  }
  if (ms > wallMs + 5_000) return { ok: false, reason: "That run took longer than it's been going." };
  if (ms < wallMs - SLACK_MS - wallMs * 0.02) return { ok: false, reason: "Paused runs don't count as personal bests." };
  if (named.length && times[times.length - 1] < named.length * MIN_MS_PER_NAME) return { ok: false, reason: "That's faster than anyone types." };
  const inTime = times.filter((t) => t <= limitMs).length;
  return {
    ok: true,
    clear: named.length === total && total > 0 ? times[times.length - 1] : null,
    count: inTime > 0 ? { named: inTime, ms: times[inTime - 1] } : null,
  };
}

// ---------------------------------------------------------------------------
// In memory
// ---------------------------------------------------------------------------

const g = globalThis as unknown as { __pokeiqNea?: Map<string, Map<string, NeaEntry>> };

export function memoryNeaStore(): NeaStore {
  const boards = (g.__pokeiqNea ??= new Map());
  const at = (scope: string, board: string) => {
    const k = `${scope}|${board}`;
    let b = boards.get(k);
    if (!b) boards.set(k, (b = new Map()));
    return b;
  };
  return {
    async submit(scope, board, e, firstOnly) {
      const b = at(scope, board);
      const old = b.get(e.player);
      if (old && (firstOnly || betterEntry(old, e) <= 0)) return false;
      b.set(e.player, e);
      return true;
    },
    async board(scope, board) {
      return [...at(scope, board).values()].sort(betterEntry);
    },
    async mine(player) {
      const out: NeaOwnEntry[] = [];
      for (const [k, b] of boards) {
        const e = b.get(player);
        if (!e) continue;
        const cut = k.lastIndexOf("|");
        out.push({ ...e, scope: k.slice(0, cut), board: k.slice(cut + 1) as NeaBoard });
      }
      return out;
    },
  };
}
export function clearMemoryNea() {
  g.__pokeiqNea = undefined;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const MISSING = new Set(["42P01", "PGRST205"]);
let missingUntil = 0;
function missing(error: { code?: string; message?: string }) {
  if (!MISSING.has(error.code ?? "")) return false;
  if (Date.now() >= missingUntil) console.warn("[name-em-all] the leaderboards are off until migration 0039_name_em_all.sql is applied:", error.message);
  missingUntil = Date.now() + 60_000;
  return true;
}

interface Row {
  player_key: string;
  player_name: string;
  named: number;
  total: number;
  duration_ms: number;
}
const toEntry = (r: Row): NeaEntry => ({ player: r.player_key, name: publicName(r.player_name), named: r.named, total: r.total, ms: r.duration_ms });

export function supabaseNeaStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): NeaStore {
  const table = () => sb.from("name_em_all_board");
  return {
    async submit(scope, board, e, firstOnly) {
      if (Date.now() < missingUntil) return null;
      const { data, error } = await table().select("player_key, player_name, named, total, duration_ms").eq("scope", scope).eq("board", board).eq("player_key", e.player).maybeSingle<Row>();
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      if (data && (firstOnly || betterEntry(toEntry(data), e) <= 0)) return false;
      const row = { scope, board, player_key: e.player, player_name: e.name, named: e.named, total: e.total, duration_ms: e.ms, created_at: new Date().toISOString() };
      const { error: werr } = await table().upsert(row, { onConflict: "scope,board,player_key" });
      if (werr) {
        if (missing(werr)) return null;
        throw new Error(werr.message);
      }
      return true;
    },
    async board(scope, board) {
      if (Date.now() < missingUntil) return null;
      const { data, error } = await table()
        .select("player_key, player_name, named, total, duration_ms")
        .eq("scope", scope)
        .eq("board", board)
        .order("named", { ascending: false })
        .order("duration_ms", { ascending: true })
        .limit(500);
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      return (data as Row[]).map(toEntry).sort(betterEntry);
    },
    async mine(player) {
      if (Date.now() < missingUntil) return null;
      // One trainer's rows: a few per category played (indexed by migration 0053).
      const { data, error } = await table().select("scope, board, player_key, player_name, named, total, duration_ms").eq("player_key", player).limit(500);
      if (error) {
        if (missing(error)) return null;
        throw new Error(error.message);
      }
      return (data as (Row & { scope: string; board: NeaBoard })[]).map((r) => ({ ...toEntry(r), scope: r.scope, board: r.board }));
    },
  };
}

export function neaStore(): NeaStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryNeaStore();
  const sb = getServiceSupabase();
  return sb ? supabaseNeaStore(sb) : null;
}

/** A trainer's place on a board, or null if they're not on it. */
export function placeOf(rows: NeaEntry[], player: string): { position: number; total: number } | null {
  const at = rows.findIndex((r) => r.player === player);
  return at < 0 ? null : { position: at + 1, total: rows.length };
}
