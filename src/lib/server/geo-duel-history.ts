import "server-only";
import { after } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import type { GeoDuelHistoryItem, GeoDuelReplay, GeoDuelSummary } from "@/lib/geo-duel-history";
import { duelView, type Duel } from "./duel";

/**
 * PokéGuessr duel history and replays: every finished duel (casual and
 * ranked) is kept for the trainers who played it, so /guessr/history can
 * list them and /guessr/history/<code> can replay them round by round.
 *
 * A seat is known by its history key: for a ranked duel, the seat's ranked
 * key (geoRankedKey of their account, or of the signed anonymous id their
 * browser holds); otherwise the same key stamped on the seat by the duel
 * route when its trainer acts (stampHistoryKey). The keys are never sent to
 * a page. A duel nobody can be identified in (two guests without an id)
 * isn't kept. What's kept is only what both trainers saw at the end: names,
 * the screenshots, both pins and the true places, scores, damage, HP and
 * the rating change.
 *
 * Rows live in Supabase (`geo_duel_history`, migration 0049), or in memory
 * with POKEIQ_LOCAL_ACCOUNTS=1 and in development without Supabase. Before
 * the migration is applied nothing is kept and the history page says so.
 */

export interface HistoryRow {
  code: string;
  /** Each seat's history key; null for the bot or a guest without one. */
  keys: [string | null, string | null];
  ranked: boolean;
  endedAt: number;
  summary: GeoDuelSummary;
  rounds: GeoDuelReplay["rounds"];
  public: boolean;
}

export type HistoryListRow = Omit<HistoryRow, "rounds">;

export class HistoryUnavailable extends Error {}

export interface DuelHistoryStore {
  /** Saves a finished duel (again: replaces the summary and rounds, keeps whether it's public). */
  put(row: Omit<HistoryRow, "public">): Promise<void>;
  /** A trainer's duels, newest first, ended before `before` (ms) when given. */
  list(key: string, before: number | null, limit: number): Promise<HistoryListRow[]>;
  get(code: string): Promise<HistoryRow | null>;
  setPublic(code: string, value: boolean): Promise<void>;
}

/** History keys look like ranked keys: an HMAC in base64url. */
export const HISTORY_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const HISTORY_PAGE = 20;

// ---------------------------------------------------------------------------
// From a duel to a row
// ---------------------------------------------------------------------------

/** Each seat's history key: the ranked key for a ranked duel, else the one stamped on the seat. */
export function historyKeysOf(duel: Duel): [string | null, string | null] {
  const key = (seat: number) => {
    const p = duel.players[seat];
    if (!p || p.bot) return null;
    return duel.ranked?.keys[seat] ?? p.historyKey ?? null;
  };
  return [key(0), key(1)];
}

/** A finished duel is ready to keep once it's over and, if ranked, counted (so the row has the rating change). */
export const historyReady = (duel: Duel | undefined): boolean => !!duel && duel.status === "finished" && !!duel.end && duel.players.length === 2 && (!duel.ranked || !!duel.ranked.result);

/** The row a finished duel is kept as, or null when it isn't ready or nobody in it can be identified. */
export function historyRowOf(duel: Duel): Omit<HistoryRow, "public"> | null {
  if (!historyReady(duel)) return null;
  const keys = historyKeysOf(duel);
  if (!keys[0] && !keys[1]) return null;
  const end = duel.end!;
  // Exactly what a visitor's view of the finished duel shows: no tokens, keys or seed.
  const view = duelView(duel, null, end.at, 0);
  const summary: GeoDuelSummary = {
    region: duel.region,
    ...(duel.era ? { era: duel.era } : {}),
    mode: view.mode,
    ...(view.turbo ? { turbo: true } : {}),
    ranked: !!duel.ranked,
    players: duel.players.map((p) => ({ name: p.name, ...(p.bot ? { bot: true } : {}) })),
    winner: end.winner,
    reason: end.reason,
    hp: [...duel.hp],
    ...(view.totals ? { totals: view.totals } : {}),
    ...(duel.ranked?.result ? { elo: duel.ranked.result } : {}),
  };
  return { code: duel.code, keys, ranked: !!duel.ranked, endedAt: end.at, summary, rounds: view.revealed };
}

/** Stamps the acting trainer's history key on their seat (unchanged when there's no key, it's already there, or the seat is the bot's). */
export function stampHistoryKey(duel: Duel, playerId: string, key: string | null): Duel {
  if (!key || !HISTORY_KEY_RE.test(key)) return duel;
  const seat = duel.players.findIndex((p) => p.id === playerId);
  const p = duel.players[seat];
  if (!p || p.bot || p.historyKey === key) return duel;
  return { ...duel, players: duel.players.map((q, i) => (i === seat ? { ...q, historyKey: key } : q)) };
}

// ---------------------------------------------------------------------------
// Who may see what
// ---------------------------------------------------------------------------

/** The seat a key played in (the first one if both), or -1. */
export function seatOfKey(row: Pick<HistoryRow, "keys">, key: string | null): number {
  if (!key) return -1;
  return row.keys[0] === key ? 0 : row.keys[1] === key ? 1 : -1;
}

/** A replay is for the two trainers who played it, and for anyone once one of them has made it public. */
export const canViewReplay = (row: Pick<HistoryRow, "keys" | "public">, key: string | null): boolean => row.public || seatOfKey(row, key) >= 0;

/** Only the trainers who played a duel can share or unshare its replay. */
export const canShareReplay = (row: Pick<HistoryRow, "keys">, key: string | null): boolean => seatOfKey(row, key) >= 0;

/** A row as one trainer's history lists it (from their seat). */
export function historyItemFor(row: HistoryListRow, key: string): GeoDuelHistoryItem | null {
  const me = seatOfKey(row, key);
  if (me < 0) return null;
  const them = 1 - me;
  const s = row.summary;
  const result = s.winner === null ? "draw" : s.winner === me ? "win" : "loss";
  return {
    code: row.code,
    endedAt: row.endedAt,
    ranked: row.ranked,
    mode: s.mode,
    region: s.region,
    ...(s.turbo ? { turbo: true } : {}),
    opponent: { name: s.players[them]?.name ?? "Unknown", ...(s.players[them]?.bot ? { bot: true } : {}) },
    result,
    hp: [s.hp[me] ?? 0, s.hp[them] ?? 0],
    ...(s.totals ? { totals: [s.totals[me] ?? 0, s.totals[them] ?? 0] as [number, number] } : {}),
    ...(s.elo ? { elo: { before: s.elo.before[me], after: s.elo.after[me] } } : {}),
    public: row.public,
  };
}

/** The replay as a viewer gets it: everything public, plus their seat (null for someone viewing a shared replay). */
export function replayFor(row: HistoryRow, key: string | null): GeoDuelReplay | null {
  if (!canViewReplay(row, key)) return null;
  const me = seatOfKey(row, key);
  return { code: row.code, endedAt: row.endedAt, ...row.summary, rounds: row.rounds, you: me >= 0 ? me : null, public: row.public };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqGeoDuelHistory?: Map<string, string> };

export function memoryHistoryStore(): DuelHistoryStore {
  const rows = (globalStore.__pokeiqGeoDuelHistory ??= new Map());
  const read = (code: string) => {
    const json = rows.get(code);
    return json ? (JSON.parse(json) as HistoryRow) : null;
  };
  return {
    async put(row) {
      rows.set(row.code, JSON.stringify({ ...row, public: read(row.code)?.public ?? false }));
    },
    async list(key, before, limit) {
      return [...rows.values()]
        .map((j) => JSON.parse(j) as HistoryRow)
        .filter((r) => seatOfKey(r, key) >= 0 && (before === null || r.endedAt < before))
        .sort((a, b) => b.endedAt - a.endedAt)
        .slice(0, limit)
        .map(({ rounds: _rounds, ...rest }) => rest);
    },
    async get(code) {
      return read(code);
    },
    async setPublic(code, value) {
      const row = read(code);
      if (row) rows.set(code, JSON.stringify({ ...row, public: value }));
    },
  };
}

/** Forgets every kept duel (tests). */
export function clearMemoryHistory() {
  globalStore.__pokeiqGeoDuelHistory = undefined;
}

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    if (Date.now() >= missingUntil) console.warn("[geo-duel-history] duel history is off until migration 0049_geo_seasons_history.sql is applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new HistoryUnavailable(error.message);
  }
  throw new Error(error.message);
}

type Db = NonNullable<ReturnType<typeof getServiceSupabase>>;
const LIST_COLUMNS = "code, key_a, key_b, ranked, ended_at, summary, public";

function fromDb(r: Record<string, unknown>): HistoryListRow {
  return {
    code: String(r.code),
    keys: [(r.key_a as string | null) ?? null, (r.key_b as string | null) ?? null],
    ranked: !!r.ranked,
    endedAt: Date.parse(String(r.ended_at)),
    summary: r.summary as GeoDuelSummary,
    public: !!r.public,
  };
}

export function supabaseHistoryStore(sb: Db): DuelHistoryStore {
  const guard = () => {
    if (Date.now() < missingUntil) throw new HistoryUnavailable("migration 0049 not applied");
  };
  return {
    async put(row) {
      guard();
      const { error } = await sb.from("geo_duel_history").upsert(
        { code: row.code, key_a: row.keys[0], key_b: row.keys[1], ranked: row.ranked, ended_at: new Date(row.endedAt).toISOString(), summary: row.summary, rounds: row.rounds },
        { onConflict: "code" }
      );
      check(error);
    },
    async list(key, before, limit) {
      guard();
      // One indexed query per seat column, merged: faster than an OR across both.
      const seat = (column: "key_a" | "key_b") => {
        let q = sb.from("geo_duel_history").select(LIST_COLUMNS).eq(column, key);
        if (before !== null) q = q.lt("ended_at", new Date(before).toISOString());
        return q.order("ended_at", { ascending: false }).limit(limit);
      };
      const [a, b] = await Promise.all([seat("key_a"), seat("key_b")]);
      check(a.error);
      check(b.error);
      const seen = new Set<string>();
      return [...(a.data ?? []), ...(b.data ?? [])]
        .map((r) => fromDb(r as Record<string, unknown>))
        .filter((r) => !seen.has(r.code) && seen.add(r.code))
        .sort((x, y) => y.endedAt - x.endedAt)
        .slice(0, limit);
    },
    async get(code) {
      guard();
      const { data, error } = await sb.from("geo_duel_history").select(`${LIST_COLUMNS}, rounds`).eq("code", code).maybeSingle();
      check(error);
      if (!data) return null;
      const r = data as Record<string, unknown>;
      return { ...fromDb(r), rounds: r.rounds as HistoryRow["rounds"] };
    },
    async setPublic(code, value) {
      guard();
      const { error } = await sb.from("geo_duel_history").update({ public: value }).eq("code", code);
      check(error);
    },
  };
}

/** Where history lives: memory for tests, local E2E and development without Supabase; else Supabase; null in production without it. */
export function historyStore(): DuelHistoryStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryHistoryStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseHistoryStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryHistoryStore() : null;
}

// ---------------------------------------------------------------------------
// Keeping a duel
// ---------------------------------------------------------------------------

/**
 * After a write or a poll: when the duel has just become ready to keep (it
 * finished, and a ranked one was counted), it's saved for its trainers after
 * the response. Never throws.
 */
export function keepFinishedDuel(before: Duel | undefined, duel: Duel, store: DuelHistoryStore | null = historyStore()): Promise<void> | void {
  if (!store || historyReady(before) || !historyReady(duel)) return;
  const row = historyRowOf(duel);
  if (!row) return;
  const send = async () => {
    try {
      await store.put(row);
    } catch (err) {
      if (!(err instanceof HistoryUnavailable)) console.error("[geo-duel-history] not kept:", err);
    }
  };
  try {
    after(send);
  } catch {
    return send();
  }
}
