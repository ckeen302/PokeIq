import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { PLAY_FORMAT_INFO } from "@/lib/battle/play";
import { customName } from "@/lib/battle/custom-rules";
import { REPLAY_ID_RE, type ReplayData, type ReplaySummary } from "@/lib/battle/replay";
import type { BattleRecord } from "./store";

/**
 * Saved replays. A replay stores the battle's spectator channel only (what
 * Showdown shows its spectators), never a player's channel, a request, the
 * input log or the seed, so a replay can't reveal anything the battle
 * itself didn't. Each replay also keeps the trainers' ladder keys (HMACs,
 * server-side only) for "My replays".
 *
 * Replays live in Supabase (`battle_replays`, migration 0018), or in memory
 * with POKEIQ_LOCAL_ACCOUNTS=1 and in development without Supabase. Until
 * the migration is applied, saving and listing say replays aren't available.
 */

export interface StoredReplay extends ReplayData {
  /** The trainers' ladder keys. Server-side only. */
  keys: string[];
}

export interface ReplayStore {
  /** Saves a replay; a second save of the same battle changes nothing. */
  save(replay: StoredReplay): Promise<void>;
  get(id: string): Promise<ReplayData | null>;
  /** Public replays, newest first. */
  recent(format: string | null, limit: number): Promise<ReplaySummary[]>;
  /** A trainer's replays (by ladder key) and any of `ids`, newest first. */
  mine(key: string | null, ids: string[], limit: number): Promise<ReplaySummary[]>;
}

/** The table isn't there (migration 0018 hasn't been applied). */
export class ReplaysUnavailable extends Error {}

/** The replay of a finished battle: its spectator channel and how it ended. */
export function replayFromRecord(rec: BattleRecord, listed: boolean, now = Date.now()): StoredReplay {
  const meta = rec.meta;
  const info = PLAY_FORMAT_INFO[meta.format];
  const replay: StoredReplay = {
    id: meta.code,
    format: meta.format,
    formatName: meta.rules ? customName(meta.rules) : meta.factoryTier ? `${info.name} · ${meta.factoryTier}` : info.name,
    players: [meta.seats[0]?.name ?? "Player 1", meta.seats[1]?.name ?? "Player 2"],
    winner: meta.end?.winner ?? null,
    reason: meta.end?.reason ?? "normal",
    turns: meta.turn,
    ranked: !!meta.ranked,
    public: listed,
    uploadedAt: now,
    // The spectator channel and nothing else.
    log: [...rec.logs.spectator],
    keys: meta.seats.map((s) => s.player).filter((k): k is string => !!k),
  };
  const r = meta.settled?.ratings;
  const brought = meta.ranked && meta.seats[0]?.rating && meta.seats[1]?.rating ? [meta.seats[0].rating, meta.seats[1].rating] : null;
  if (r) {
    replay.ratings = [r[0].before, r[1].before];
    if (r[0].elo && r[1].elo) replay.elos = [r[0].elo.before, r[1].elo.before];
  } else if (brought) {
    replay.ratings = [brought[0].rating, brought[1].rating];
    if (brought[0].elo !== undefined && brought[1].elo !== undefined) replay.elos = [brought[0].elo, brought[1].elo];
  }
  return replay;
}

function summary(data: ReplayData): ReplaySummary {
  const rest: Partial<ReplayData> = { ...data };
  delete rest.log;
  return rest as ReplaySummary;
}

/** A stored replay without the trainers' keys. */
function publicData(stored: StoredReplay): ReplayData {
  const rest: Partial<StoredReplay> = { ...stored };
  delete rest.keys;
  return rest as ReplayData;
}

// ---- memory -------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqReplays?: Map<string, StoredReplay> };

export function memoryReplayStore(): ReplayStore {
  const db = (globalStore.__pokeiqReplays ??= new Map());
  const newest = (list: StoredReplay[]) => list.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return {
    async save(replay) {
      if (!db.has(replay.id)) db.set(replay.id, structuredClone(replay));
    },
    async get(id) {
      const r = db.get(id);
      return r ? structuredClone(publicData(r)) : null;
    },
    async recent(format, limit) {
      return newest([...db.values()].filter((r) => r.public && (!format || r.format === format)))
        .slice(0, limit)
        .map((r) => summary(publicData(r)));
    },
    async mine(key, ids, limit) {
      return newest([...db.values()].filter((r) => (key && r.keys.includes(key)) || ids.includes(r.id)))
        .slice(0, limit)
        .map((r) => summary(publicData(r)));
    },
  };
}

export function clearMemoryReplays() {
  globalStore.__pokeiqReplays = undefined;
}

// ---- Supabase -------------------------------------------------------------------

const TABLE = "battle_replays";
const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    if (Date.now() >= missingUntil) console.warn("[replays] replays are off until migration 0018_battle_replays_ladder.sql is applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new ReplaysUnavailable(error.message);
  }
  throw new Error(error.message);
}

interface Row {
  id: string;
  format: string;
  format_name: string;
  players: string[];
  ratings: number[] | null;
  elos?: number[] | null;
  winner: number | null;
  end_reason: string;
  turns: number;
  ranked: boolean;
  public: boolean;
  created_at: string;
  log?: string;
}

const SUMMARY_COLUMNS = "id, format, format_name, players, ratings, elos, winner, end_reason, turns, ranked, public, created_at";
const REASONS = new Set(["normal", "forfeit", "timeout", "left", "nocontest"]);

function fromRow(row: Row): ReplaySummary {
  const s: ReplaySummary = {
    id: row.id,
    format: row.format as ReplaySummary["format"],
    formatName: row.format_name,
    players: [row.players[0] ?? "", row.players[1] ?? ""],
    winner: row.winner === 0 || row.winner === 1 ? row.winner : null,
    reason: (REASONS.has(row.end_reason) ? row.end_reason : "normal") as ReplaySummary["reason"],
    turns: row.turns,
    ranked: row.ranked,
    public: row.public,
    uploadedAt: Date.parse(row.created_at),
  };
  if (row.ratings?.length === 2) s.ratings = [row.ratings[0], row.ratings[1]];
  if (row.elos?.length === 2) s.elos = [row.elos[0], row.elos[1]];
  return s;
}

export function supabaseReplayStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): ReplayStore {
  const guard = () => {
    if (Date.now() < missingUntil) throw new ReplaysUnavailable("migration 0018 not applied");
  };
  return {
    async save(r) {
      guard();
      const { error } = await sb.from(TABLE).upsert(
        {
          id: r.id,
          format: r.format,
          format_name: r.formatName,
          players: r.players,
          ratings: r.ratings ?? null,
          elos: r.elos ?? null,
          winner: r.winner,
          end_reason: r.reason,
          turns: r.turns,
          ranked: r.ranked,
          public: r.public,
          log: r.log.join("\n"),
          player_keys: r.keys,
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
      check(error);
    },
    async get(id) {
      if (!REPLAY_ID_RE.test(id)) return null;
      guard();
      const { data, error } = await sb.from(TABLE).select(`${SUMMARY_COLUMNS}, log`).eq("id", id).maybeSingle<Row>();
      check(error);
      return data ? { ...fromRow(data), log: data.log ? data.log.split("\n") : [] } : null;
    },
    async recent(format, limit) {
      guard();
      let q = sb.from(TABLE).select(SUMMARY_COLUMNS).eq("public", true);
      if (format) q = q.eq("format", format);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
      check(error);
      return ((data ?? []) as Row[]).map(fromRow);
    },
    async mine(key, ids, limit) {
      guard();
      const wanted = ids.filter((id) => REPLAY_ID_RE.test(id)).slice(0, 50);
      if (!key && !wanted.length) return [];
      const filters = [key ? `player_keys.cs.{${key}}` : null, wanted.length ? `id.in.(${wanted.join(",")})` : null].filter(Boolean).join(",");
      const { data, error } = await sb.from(TABLE).select(SUMMARY_COLUMNS).or(filters).order("created_at", { ascending: false }).limit(limit);
      check(error);
      return ((data ?? []) as Row[]).map(fromRow);
    },
  };
}

/** Where replays live: memory for tests, local E2E and development without Supabase; else Supabase; null in production without it. */
export function replayStore(): ReplayStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryReplayStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseReplayStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryReplayStore() : null;
}
