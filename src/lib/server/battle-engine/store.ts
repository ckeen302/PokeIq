import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import type { BattleEnd, PlayFormatId, BattleKind, BattleRatings, BattleRequest, CpuLevel } from "@/lib/battle/play";
import type { DuelStatus } from "@/lib/duel-types";
import type { ChatLine } from "@/lib/chat";
import type { CustomRules } from "@/lib/battle/custom-rules";
import type { FrontierBattleInfo } from "@/lib/battle/frontier";
import type { FrontierRun } from "./frontier";

/**
 * Where battles live while they're played: one row per battle in Supabase
 * (`battles`, RLS-locked, service role only), as with duels. A row holds:
 *
 * - `meta`: seats, presence, the pending request per side and its counter,
 *   the clocks and the result (small; every poll reads it);
 * - `state`: the simulator snapshot (text, ~55 KB; TOAST-compressed);
 * - `input_log`: the simulator's input log, the source of truth;
 * - `log_p1`, `log_p2`, `log_spectator`: each viewer's protocol channel,
 *   newline-joined, so a poll reads only its own.
 *
 * Every write is a compare-and-swap on `version`, and only the columns that
 * changed are sent (a presence tick rewrites `meta` alone).
 *
 * Without Supabase (or with POKEIQ_LOCAL_ACCOUNTS=1) battles live in memory,
 * which is right for one server process: local development and the E2E test.
 */

export type BattleChannel = "p1" | "p2" | "spectator";

export interface BattleSeat {
  id: string;
  name: string;
  ready: boolean;
  /** Last request from this player (kept to the nearest few seconds, to spare writes). */
  seenAt: number;
  /** A brought team, packed and validated (bring-your-own formats). Server-side only. */
  team?: string;
  /** The trainer's ladder key (an HMAC of their account or signed anonymous id). Server-side only. */
  player?: string;
  /** Ranked battles: the Glicko-2 rating, ranked games and Elo this trainer had when matched. */
  rating?: { rating: number; games: number; elo?: number };
  /** Tournament battles: when this trainer first opened the battle (absent: they never showed). */
  arrived?: number;
}

export interface SideClock {
  /** Time left in the bank. */
  bank: number;
  /** When the current request was made, and when its choice is due (null: nothing owed). */
  startedAt: number | null;
  deadline: number | null;
  /** The pending request is team preview (its time doesn't come out of the bank). */
  preview: boolean;
  /** Turns in a row the clock ran out. */
  timeouts: number;
}

export interface BattleMeta {
  v: 1;
  code: string;
  kind: BattleKind;
  format: PlayFormatId;
  /** Showdown's format id, where it isn't `format` (custom rules: "gen4customgame@@@..."). Validated before it's stored. */
  formatid?: string;
  /** Custom rules: the ruleset the players chose. */
  rules?: CustomRules;
  /** A Battle Frontier run's battle: where the run stood, and its state (server-side only: the player's team). */
  frontier?: { info: FrontierBattleInfo; run: FrontierRun };
  /** A live Battle Factory battle: the tier both rental teams come from. */
  factoryTier?: string;
  status: DuelStatus;
  simVersion: string;
  /** The simulator's PRNG seed. Server-side only. */
  seed: string;
  createdAt: number;
  /** When both trainers were in and the battle began. */
  startedAt?: number;
  /** Seat 0 plays p1, seat 1 plays p2. */
  seats: BattleSeat[];
  cpu?: { level: CpuLevel };
  turn: number;
  /** Per side: increases whenever that side gets a new request; a choice must quote it. */
  rqid: [number, number];
  /** Per side: the request it must answer now (null: nothing owed, or already chosen). */
  requests: [BattleRequest | null, BattleRequest | null];
  /** Choices made for a turn that hasn't run yet (needed to rebuild from the input log). Server-side only. */
  chosen?: { p1?: string; p2?: string };
  /** Live battles only. */
  clocks?: [SideClock, SideClock];
  /** Lines in each channel (so a poll knows the total without counting). */
  lines: Record<BattleChannel, number>;
  end?: BattleEnd;
  rematch?: string;
  /** Live battles: the players' chat, the last few dozen lines (a rematch carries them on). */
  chat?: ChatLine[];
  /** Live battles: listed in the Watch lobby (matchmade battles always; friend battles when the host lets anyone watch). */
  public?: boolean;
  /** A trainer chose "Don't allow spectators": never listed, no spectators while it's played, an unlisted replay. */
  hidden?: boolean;
  /** A ranked ladder battle (matchmade or a rated tournament match). */
  ranked?: boolean;
  /** A tournament match: the tournament's id. */
  tournament?: string;
  /** Spectators: an anonymous viewer id → when it last polled. */
  watchers?: Record<string, number>;
  /** Live battles: the timer is off until a player starts it. */
  timerOff?: boolean;
  /** Live battles: the seats that asked for the timer (Showdown's timer requesters: only they can turn it off). */
  timerRequesters?: number[];
  /** Who last turned the timer off, and when (Showdown's 20 s cooldown before they can turn it on again). */
  timerOffBy?: { seat: number; at: number };
  /** The turn the clocks were last topped up for (undefined: the timer hasn't seen a request yet). */
  timerTurn?: number;
  /** The pending requests are the first since the timer started (Showdown's maxFirstTurn applies). */
  timerFirst?: boolean;
  /** Loss on timeout (Showdown-style): running out the clock once loses, instead of the timer choosing for you. */
  timeoutLoses?: boolean;
  /** After the end: what was recorded (ratings, history, the replay). */
  settled?: BattleSettled;
  /** The saved replay's id. */
  replay?: string;
}

export interface BattleSettled {
  at: number;
  /** Ranked: each seat's ratings (Glicko-2, and Elo) before and after. */
  ratings?: BattleRatings;
}

export interface BattleRecord {
  meta: BattleMeta;
  /** The simulator snapshot (null before the battle starts). */
  state: string | null;
  inputLog: string[];
  logs: Record<BattleChannel, string[]>;
}

/** The parts of a record a write changes; `meta` always (it carries the version's meaning). */
export interface BattlePatch {
  meta: BattleMeta;
  state?: string | null;
  inputLog?: string[];
  logs?: Partial<Record<BattleChannel, string[]>>;
}

/** A battle is kept this long after its last change. */
const TTL_MS = 3 * 60 * 60 * 1000;
const TABLE = "battles";

function remote() {
  return process.env.POKEIQ_LOCAL_ACCOUNTS === "1" ? null : getServiceSupabase();
}

export function battlesEnabled(): boolean {
  return remote() !== null || process.env.NODE_ENV !== "production" || process.env.POKEIQ_LOCAL_ACCOUNTS === "1";
}

const joinLines = (lines: string[]) => lines.join("\n");
const splitLines = (text: string | null | undefined) => (text ? text.split("\n") : []);

interface Row {
  meta: BattleMeta;
  state: string | null;
  input_log: string[];
  log_p1: string;
  log_p2: string;
  log_spectator: string;
  version: number;
  expires_at: string;
}

interface MemoryRow {
  /** Stored as JSON, so no caller ever holds a live reference to it. */
  json: string;
  version: number;
  expires: number;
}

const globalStore = globalThis as unknown as { __pokeiqBattles?: Map<string, MemoryRow> };
const memory = () => (globalStore.__pokeiqBattles ??= new Map());

const expiry = () => new Date(Date.now() + TTL_MS).toISOString();

/** The meta and one channel's log (what a poll needs); null if there's no such battle. */
export async function loadBattleMeta(code: string, channel: BattleChannel | null): Promise<{ meta: BattleMeta; version: number; log: string[] } | null> {
  if (!DUEL_CODE_RE.test(code)) return null;
  const sb = remote();
  if (sb) {
    const column = channel ? `log_${channel}` : null;
    const { data, error } = await sb
      .from(TABLE)
      .select(`meta, version, expires_at${column ? `, ${column}` : ""}`)
      .eq("code", code)
      .maybeSingle<Pick<Row, "meta" | "version" | "expires_at"> & Partial<Row>>();
    if (error) throw new Error(error.message);
    if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
    const log = column ? splitLines((data as Record<string, unknown>)[column] as string) : [];
    return { meta: data.meta, version: data.version, log };
  }
  const row = memory().get(code);
  if (!row || row.expires <= Date.now()) return null;
  const rec = JSON.parse(row.json) as BattleRecord;
  return { meta: rec.meta, version: row.version, log: channel ? rec.logs[channel] : [] };
}

/** The whole battle (for anything that runs the simulator). */
export async function loadBattle(code: string): Promise<{ rec: BattleRecord; version: number } | null> {
  if (!DUEL_CODE_RE.test(code)) return null;
  const sb = remote();
  if (sb) {
    const { data, error } = await sb
      .from(TABLE)
      .select("meta, state, input_log, log_p1, log_p2, log_spectator, version, expires_at")
      .eq("code", code)
      .maybeSingle<Row>();
    if (error) throw new Error(error.message);
    if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
    return {
      rec: {
        meta: data.meta,
        state: data.state,
        inputLog: data.input_log ?? [],
        logs: { p1: splitLines(data.log_p1), p2: splitLines(data.log_p2), spectator: splitLines(data.log_spectator) },
      },
      version: data.version,
    };
  }
  const row = memory().get(code);
  if (!row || row.expires <= Date.now()) return null;
  return { rec: JSON.parse(row.json) as BattleRecord, version: row.version };
}

/** A new battle; false if the code is taken. */
export async function insertBattle(rec: BattleRecord): Promise<boolean> {
  const sb = remote();
  if (sb) {
    // Opportunistic cleanup keeps the table small without a cron job.
    await sb.from(TABLE).delete().lt("expires_at", new Date().toISOString());
    const { error } = await sb.from(TABLE).insert({
      code: rec.meta.code,
      kind: rec.meta.kind,
      format: rec.meta.format,
      sim_version: rec.meta.simVersion,
      version: 0,
      meta: rec.meta,
      state: rec.state,
      input_log: rec.inputLog,
      log_p1: joinLines(rec.logs.p1),
      log_p2: joinLines(rec.logs.p2),
      log_spectator: joinLines(rec.logs.spectator),
      expires_at: expiry(),
    });
    if (error?.code === "23505") return false;
    if (error) throw new Error(error.message);
    return true;
  }
  const rows = memory();
  for (const [code, row] of rows) if (row.expires <= Date.now()) rows.delete(code);
  if (rows.has(rec.meta.code)) return false;
  rows.set(rec.meta.code, { json: JSON.stringify({ ...rec, meta: jsonbOrder(rec.meta) }), version: 0, expires: Date.now() + TTL_MS });
  return true;
}

/**
 * An object with its keys in the order Postgres's jsonb gives them back
 * (shorter keys first, then bytewise), so the in-memory store hands back
 * `meta` exactly as Supabase would: nothing may rely on key order.
 */
export function jsonbOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map(jsonbOrder) as T;
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map((k) => [k, jsonbOrder((value as Record<string, unknown>)[k])])) as T;
}

/**
 * Compare-and-swap: writes `patch` only if the stored version is still
 * `version`. False if someone got there first.
 */
export async function saveBattle(code: string, version: number, patch: BattlePatch): Promise<boolean> {
  const sb = remote();
  if (sb) {
    const update: Record<string, unknown> = {
      meta: patch.meta,
      sim_version: patch.meta.simVersion,
      version: version + 1,
      updated_at: new Date().toISOString(),
      expires_at: expiry(),
    };
    if (patch.state !== undefined) update.state = patch.state;
    if (patch.inputLog) update.input_log = patch.inputLog;
    for (const [channel, lines] of Object.entries(patch.logs ?? {})) update[`log_${channel}`] = joinLines(lines);
    const { data, error } = await sb.from(TABLE).update(update).eq("code", code).eq("version", version).select("code");
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  }
  const rows = memory();
  const row = rows.get(code);
  if (!row || row.version !== version) return false;
  const rec = JSON.parse(row.json) as BattleRecord;
  rec.meta = jsonbOrder(patch.meta);
  if (patch.state !== undefined) rec.state = patch.state;
  if (patch.inputLog) rec.inputLog = patch.inputLog;
  for (const [channel, lines] of Object.entries(patch.logs ?? {})) rec.logs[channel as BattleChannel] = lines;
  rows.set(code, { json: JSON.stringify(rec), version: version + 1, expires: Date.now() + TTL_MS });
  return true;
}

export async function deleteBattle(code: string): Promise<void> {
  const sb = remote();
  if (sb) {
    await sb.from(TABLE).delete().eq("code", code);
    return;
  }
  memory().delete(code);
}

/** One live battle as the Watch lobby lists it (no simulator needed). */
export interface LiveBattleRow {
  meta: BattleMeta;
  createdAt: number;
}

/**
 * Live battles under way that are listed for watching (newest first, at most
 * `limit`): matchmade and opted-in friend battles. Only `meta` is read; the
 * caller picks the public fields out of it.
 */
export async function listLiveBattles(limit = 60): Promise<LiveBattleRow[]> {
  const sb = remote();
  if (sb) {
    const { data, error } = await sb
      .from(TABLE)
      .select("meta, created_at")
      .eq("kind", "pvp")
      .eq("meta->>status", "playing")
      .eq("meta->>public", "true")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: { meta: BattleMeta; created_at: string }) => ({ meta: r.meta, createdAt: Date.parse(r.created_at) }));
  }
  const now = Date.now();
  return [...memory().values()]
    .filter((row) => row.expires > now)
    .map((row) => (JSON.parse(row.json) as BattleRecord).meta)
    .filter((m) => m.kind === "pvp" && m.status === "playing" && m.public === true)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((meta) => ({ meta, createdAt: meta.createdAt }));
}

/**
 * Live battles between trainers under way right now (any privacy: only
 * counted, never listed), touched within `freshMs`: just each seat's ladder
 * key, for the live counters on the battle home.
 */
export async function activeBattleSeats(freshMs = 120_000, limit = 1000): Promise<(string | null)[][]> {
  const now = Date.now();
  const sb = remote();
  if (sb) {
    const { data, error } = await sb
      .from(TABLE)
      .select("seats:meta->seats")
      .eq("kind", "pvp")
      .eq("meta->>status", "playing")
      .gt("updated_at", new Date(now - freshMs).toISOString())
      .gt("expires_at", new Date(now).toISOString())
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as { seats: { player?: string }[] | null }[]).map((r) => (r.seats ?? []).map((s) => s.player ?? null));
  }
  return [...memory().values()]
    .filter((row) => row.expires > now)
    .map((row) => (JSON.parse(row.json) as BattleRecord).meta)
    .filter((m) => m.kind === "pvp" && m.status === "playing" && m.seats.some((s) => now - s.seenAt <= freshMs))
    .slice(0, limit)
    .map((m) => m.seats.map((s) => s.player ?? null));
}

/**
 * A battle's public summary for its page and preview card (no simulator
 * needed): null if there's no such battle, undefined if the store couldn't say.
 */
export async function peekBattle(code: string): Promise<{ kind: BattleKind; format: PlayFormatId; names: string[]; status: DuelStatus } | null | undefined> {
  try {
    const lite = await loadBattleMeta(code, null);
    if (!lite) return null;
    return { kind: lite.meta.kind, format: lite.meta.format, names: lite.meta.seats.map((s) => s.name), status: lite.meta.status };
  } catch (err) {
    console.error("[battle] read failed:", err);
    return undefined;
  }
}
