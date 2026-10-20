import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import type { BestOf, TournamentFormat, TournamentStatus, TournamentStyle } from "@/lib/tournaments";
import type { ElimBracket } from "./generator-elimination";
import type { RRTable } from "./generator-round-robin";

/**
 * Where tournaments live (migration 0020): one `tournaments` row each, the
 * whole tournament in `data`, every write a compare-and-swap on `version`.
 * Memory with POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run) and in
 * development without Supabase; production without Supabase has none.
 * Before the migration is applied every call throws TournamentsUnavailable.
 */

export class TournamentsUnavailable extends Error {}

export interface TourPlayer {
  /** Account id (server-only). */
  id: string;
  name: string;
  /** Ladder key (server-only). */
  key: string;
  /** A checked, packed team in bring-your-own formats (server-only). */
  team?: string;
  joinedAt: number;
  score: number;
  wins: number;
  losses: number;
  games: number;
  dq?: boolean;
}

export interface TourGame {
  code: string;
  /** Each seat's id in the battle (server-only: they make the seat tokens). */
  ids: [string, string];
  createdAt: number;
  /** Once over: the seat that won (null: a draw). */
  winner?: 0 | 1 | null;
}

export interface TourMatch {
  id: string;
  /** Player indices: a is player 1 (the elimination node's left child, the round robin row). */
  a: number;
  b: number;
  round: number;
  wins: [number, number];
  games: TourGame[];
  current: TourGame | null;
  /** A server is creating this match's battle. */
  claim: { by: string; at: number } | null;
  done: boolean;
  /** 0: a won, 1: b won, null: a draw (round robin). */
  winner: 0 | 1 | null;
  note?: "noshow" | "dq";
}

export interface TourRecord {
  v: 1;
  id: string;
  format: TournamentFormat;
  style: TournamentStyle;
  bestOf: BestOf;
  maxPlayers: number;
  official: boolean;
  /** The creator (account id, server-only) and their name. */
  host: string | null;
  hostName: string | null;
  status: TournamentStatus;
  createdAt: number;
  signupEndsAt: number;
  startedAt?: number;
  endedAt?: number;
  players: TourPlayer[];
  elim?: ElimBracket;
  rr?: RRTable;
  matches: TourMatch[];
  /** Final places, best first (player indices). */
  results?: number[][];
  rated: boolean;
  cancelReason?: string;
}

export interface TournamentStore {
  get(id: string): Promise<{ rec: TourRecord; version: number } | null>;
  /** False if the id is taken. */
  insert(rec: TourRecord): Promise<boolean>;
  /** Compare-and-swap: false if someone else wrote first. */
  save(rec: TourRecord, version: number): Promise<boolean>;
  /** Open and running tournaments, or (finished) the latest finished and cancelled ones. */
  list(which: "active" | "finished", limit: number): Promise<{ rec: TourRecord; version: number }[]>;
  /** Running tournaments `userId` plays in. */
  running(userId: string): Promise<{ rec: TourRecord; version: number }[]>;
}

const ACTIVE: TournamentStatus[] = ["signup", "running"];

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqTournaments?: Map<string, { rec: TourRecord; version: number }> };
const db = (): Map<string, { rec: TourRecord; version: number }> => (globalStore.__pokeiqTournaments ??= new Map());

export function clearMemoryTournaments() {
  globalStore.__pokeiqTournaments = new Map();
}

export function memoryTournamentStore(): TournamentStore {
  const copy = <T>(v: T): T => structuredClone(v);
  const sorted = () => [...db().values()].sort((a, b) => b.rec.createdAt - a.rec.createdAt);
  return {
    async get(id) {
      const row = db().get(id);
      return row ? copy(row) : null;
    },
    async insert(rec) {
      if (db().has(rec.id)) return false;
      db().set(rec.id, { rec: copy(rec), version: 1 });
      return true;
    },
    async save(rec, version) {
      const row = db().get(rec.id);
      if (!row || row.version !== version) return false;
      db().set(rec.id, { rec: copy(rec), version: version + 1 });
      return true;
    },
    async list(which, limit) {
      const keep = (s: TournamentStatus) => (which === "active" ? ACTIVE.includes(s) : !ACTIVE.includes(s));
      const rows = sorted().filter((r) => keep(r.rec.status));
      if (which === "finished") rows.sort((a, b) => (b.rec.endedAt ?? 0) - (a.rec.endedAt ?? 0));
      return rows.slice(0, limit).map(copy);
    },
    async running(userId) {
      return sorted()
        .filter((r) => r.rec.status === "running" && r.rec.players.some((p) => p.id === userId))
        .map(copy);
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "")) throw new TournamentsUnavailable(error.message);
  throw new Error(error.message);
}

const iso = (ms: number) => new Date(ms).toISOString();
const columns = (rec: TourRecord) => ({
  status: rec.status,
  official: rec.official,
  player_ids: rec.players.map((p) => p.id),
  signup_ends_at: iso(rec.signupEndsAt),
  ended_at: rec.endedAt ? iso(rec.endedAt) : null,
  data: rec,
});

type Row = { data: TourRecord; version: number };

export function supabaseTournamentStore(sb: Sb): TournamentStore {
  return {
    async get(id) {
      const { data, error } = await sb.from("tournaments").select("data, version").eq("id", id).maybeSingle<Row>();
      check(error);
      return data ? { rec: data.data, version: data.version } : null;
    },
    async insert(rec) {
      const { error } = await sb.from("tournaments").insert({ id: rec.id, created_at: iso(rec.createdAt), version: 1, ...columns(rec) });
      if (error?.code === "23505") return false;
      check(error);
      return true;
    },
    async save(rec, version) {
      const { data, error } = await sb
        .from("tournaments")
        .update({ ...columns(rec), version: version + 1, updated_at: new Date().toISOString() })
        .eq("id", rec.id)
        .eq("version", version)
        .select("id");
      check(error);
      return (data ?? []).length === 1;
    },
    async list(which, limit) {
      let q = sb.from("tournaments").select("data, version");
      q = which === "active" ? q.in("status", ACTIVE).order("created_at", { ascending: false }) : q.in("status", ["finished", "cancelled"]).order("ended_at", { ascending: false, nullsFirst: false });
      const { data, error } = await q.limit(limit);
      check(error);
      return ((data ?? []) as Row[]).map((r) => ({ rec: r.data, version: r.version }));
    },
    async running(userId) {
      const { data, error } = await sb.from("tournaments").select("data, version").eq("status", "running").contains("player_ids", [userId]).limit(5);
      check(error);
      return ((data ?? []) as Row[]).map((r) => ({ rec: r.data, version: r.version }));
    },
  };
}

export function tournamentStore(): TournamentStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryTournamentStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseTournamentStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryTournamentStore() : null;
}
