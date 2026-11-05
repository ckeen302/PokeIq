import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { DUEL_CODE_RE } from "@/lib/duel-types";
import { BATTLE_AWAY_MS, type BattleEnd, type PlayFormatId, type BattleKind, type BattleRatings, type BattleRequest, type CpuLevel, type GameType } from "@/lib/battle/play";
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
 *   newline-joined, so a poll reads only its own. A four-player battle's p3
 *   channel rides in `log_p1` and p4's in `log_p2`, after a separator line
 *   (CHANNEL_SEP), so the table needs no new columns.
 *
 * Every write is a compare-and-swap on `version`, and only the columns that
 * changed are sent (a presence tick rewrites `meta` alone).
 *
 * Every write also sets `next_deadline` (migration 0054): when a live
 * battle next has something due with nobody polling (a clock running out,
 * a trainer gone for BATTLE_AWAY_MS, the computer owing a choice), so the
 * tick (/api/battle/tick) finds those battles with one indexed read. Until
 * the migration is applied the column is left out of writes and the tick
 * reads live battles' meta instead.
 *
 * Without Supabase (or with POKEIQ_LOCAL_ACCOUNTS=1) battles live in memory,
 * which is right for one server process: local development and the E2E test.
 */

export type BattleChannel = "p1" | "p2" | "p3" | "p4" | "spectator";
/** Every channel a record can have (p3 and p4 only in four-player battles). */
export const ALL_CHANNELS: readonly BattleChannel[] = ["p1", "p2", "p3", "p4", "spectator"];

/** Where a channel is kept in the table, and the channel sharing that column. */
const COLUMN: Record<BattleChannel, { column: "p1" | "p2" | "spectator"; shared?: BattleChannel; second?: boolean }> = {
  p1: { column: "p1", shared: "p3" },
  p3: { column: "p1", shared: "p1", second: true },
  p2: { column: "p2", shared: "p4" },
  p4: { column: "p2", shared: "p2", second: true },
  spectator: { column: "spectator" },
};
/** Splits a column holding two channels (no protocol line has a control character). */
export const CHANNEL_SEP = "\u001e";

export interface BattleSeat {
  id: string;
  name: string;
  ready: boolean;
  /** The computer plays this seat (against the computer, or filling a four-player room). */
  cpu?: boolean;
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
  /** Seat 0 plays p1, seat 1 plays p2 (and in four-player battles seats 2 and 3 play p3 and p4). */
  seats: BattleSeat[];
  /** The computer's level, for every seat it plays. */
  cpu?: { level: CpuLevel };
  /** Showdown's game type (absent on battles from before triples and four-player battles: singles or doubles by format). */
  gameType?: GameType;
  /** Trainers this battle seats (2, or 4 in Free-For-All and Multi Battles). */
  playerCount?: number;
  /** Free-For-All: the seats knocked out so far, first out first, with the turn. */
  out?: { seat: number; turn: number }[];
  turn: number;
  /** Per side: increases whenever that side gets a new request; a choice must quote it. */
  rqid: number[];
  /** Per side: the request it must answer now (null: nothing owed, or already chosen). */
  requests: (BattleRequest | null)[];
  /** Choices made for a turn that hasn't run yet (needed to rebuild from the input log). Server-side only. */
  chosen?: { p1?: string; p2?: string; p3?: string; p4?: string };
  /** Live battles only. */
  clocks?: SideClock[];
  /** Lines in each channel (so a poll knows the total without counting). */
  lines: Partial<Record<BattleChannel, number>> & Record<"p1" | "p2" | "spectator", number>;
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
  logs: Partial<Record<BattleChannel, string[]>> & Record<"p1" | "p2" | "spectator", string[]>;
}

/** The parts of a record a write changes; `meta` always (it carries the version's meaning). */
export interface BattlePatch {
  meta: BattleMeta;
  state?: string | null;
  inputLog?: string[];
  logs?: Partial<Record<BattleChannel, string[]>>;
}

/** One column's text: a channel's lines, and after the separator the channel sharing it (four-player battles). */
export function columnText(first: string[], second: string[] | undefined): string {
  return second?.length ? joinLines([...first, CHANNEL_SEP, ...second]) : joinLines(first);
}

/** A column's two channels. */
export function columnLines(text: string | null | undefined): [string[], string[]] {
  const lines = splitLines(text);
  const at = lines.indexOf(CHANNEL_SEP);
  return at < 0 ? [lines, []] : [lines.slice(0, at), lines.slice(at + 1)];
}

/** One channel from its column. */
function channelLines(channel: BattleChannel, text: string | null | undefined): string[] {
  const [first, second] = columnLines(text);
  return COLUMN[channel].second ? second : first;
}

/** A battle is kept this long after its last change. */
const TTL_MS = 3 * 60 * 60 * 1000;
const TABLE = "battles";

/**
 * When a battle next needs catching up without anyone polling (ms), or null
 * when nothing can come due: the earliest clock deadline, the moment a
 * trainer still in it counts as gone, or now if the computer owes a choice
 * (a long run of its choices cut short). Live battles only: a battle against
 * the computer waits for its player.
 */
export function nextDeadline(meta: BattleMeta): number | null {
  if (meta.kind !== "pvp" || meta.status !== "playing") return null;
  let next = Infinity;
  for (const clock of meta.clocks ?? []) if (clock.deadline !== null) next = Math.min(next, clock.deadline);
  meta.seats.forEach((seat, i) => {
    if (seat.cpu || seat.id === "cpu") {
      if (meta.requests[i]) next = Math.min(next, 0);
    } else if (!meta.out?.some((o) => o.seat === i)) next = Math.min(next, seat.seenAt + BATTLE_AWAY_MS);
  });
  return Number.isFinite(next) ? next : null;
}

const deadlineIso = (meta: BattleMeta) => {
  const at = nextDeadline(meta);
  return at === null ? null : new Date(at).toISOString();
};

/** Postgres and PostgREST codes for a column that isn't there (the migration hasn't been applied). */
const NO_COLUMN = new Set(["42703", "PGRST204"]);
/** The next_deadline column: unknown until a write or read says, then rechecked now and then. */
let deadlineColumn: { missing: boolean; until: number } = { missing: false, until: 0 };
const DEADLINE_RECHECK_MS = 10 * 60_000;
const hasDeadlineColumn = () => !deadlineColumn.missing || Date.now() > deadlineColumn.until;
function noDeadlineColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error || !(NO_COLUMN.has(error.code ?? "") || /next_deadline/.test(error.message ?? ""))) return false;
  if (!deadlineColumn.missing) console.warn("[battle] battles.next_deadline isn't there yet (migration 0054): writing without it.");
  deadlineColumn = { missing: true, until: Date.now() + DEADLINE_RECHECK_MS };
  return true;
}

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
    const column = channel ? `log_${COLUMN[channel].column}` : null;
    const { data, error } = await sb
      .from(TABLE)
      .select(`meta, version, expires_at${column ? `, ${column}` : ""}`)
      .eq("code", code)
      .maybeSingle<Pick<Row, "meta" | "version" | "expires_at"> & Partial<Row>>();
    if (error) throw new Error(error.message);
    if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
    const log = column && channel ? channelLines(channel, (data as Record<string, unknown>)[column] as string) : [];
    return { meta: data.meta, version: data.version, log };
  }
  const row = memory().get(code);
  if (!row || row.expires <= Date.now()) return null;
  const rec = JSON.parse(row.json) as BattleRecord;
  return { meta: rec.meta, version: row.version, log: channel ? (rec.logs[channel] ?? []) : [] };
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
    const [p1, p3] = columnLines(data.log_p1);
    const [p2, p4] = columnLines(data.log_p2);
    const logs: BattleRecord["logs"] = { p1, p2, spectator: splitLines(data.log_spectator) };
    if (p3.length || p4.length || (data.meta.playerCount ?? 2) === 4) Object.assign(logs, { p3, p4 });
    return {
      rec: { meta: data.meta, state: data.state, inputLog: data.input_log ?? [], logs },
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
    // Opportunistic cleanup keeps the table small without a cron job: one insert in ten sweeps expired rows.
    if (Math.random() < 0.1) await sb.from(TABLE).delete().lt("expires_at", new Date().toISOString());
    const row: Record<string, unknown> = {
      code: rec.meta.code,
      kind: rec.meta.kind,
      format: rec.meta.format,
      sim_version: rec.meta.simVersion,
      version: 0,
      meta: rec.meta,
      state: rec.state,
      input_log: rec.inputLog,
      log_p1: columnText(rec.logs.p1, rec.logs.p3),
      log_p2: columnText(rec.logs.p2, rec.logs.p4),
      log_spectator: joinLines(rec.logs.spectator),
      expires_at: expiry(),
    };
    const withDeadline = hasDeadlineColumn();
    if (withDeadline) row.next_deadline = deadlineIso(rec.meta);
    let { error } = await sb.from(TABLE).insert(row);
    if (withDeadline && noDeadlineColumn(error)) {
      delete row.next_deadline;
      ({ error } = await sb.from(TABLE).insert(row));
    }
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
    // A column with two channels is written whole (the patch carries both whenever either changed: see the service's Work.patch).
    for (const [channel, lines] of Object.entries(patch.logs ?? {}) as [BattleChannel, string[]][]) {
      const { column, shared, second } = COLUMN[channel];
      if (second) continue;
      update[`log_${column}`] = columnText(lines, shared ? patch.logs?.[shared] : undefined);
    }
    for (const channel of ["p3", "p4"] as const) {
      const first = COLUMN[channel].shared!;
      if (patch.logs?.[channel] && !patch.logs[first]) throw new Error(`A ${channel} log must be saved with ${first}'s.`);
    }
    const withDeadline = hasDeadlineColumn();
    if (withDeadline) update.next_deadline = deadlineIso(patch.meta);
    let { data, error } = await sb.from(TABLE).update(update).eq("code", code).eq("version", version).select("code");
    // A refused write changed nothing, so it's safe to send again without the column.
    if (withDeadline && noDeadlineColumn(error)) {
      delete update.next_deadline;
      ({ data, error } = await sb.from(TABLE).update(update).eq("code", code).eq("version", version).select("code"));
    }
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

/** At most this many live battles are read per sweep when the next_deadline column isn't there yet. */
const DUE_FALLBACK_LIMIT = 200;

/**
 * Live battles with something due by `now` (a clock out, a trainer gone, the
 * computer owing a choice), soonest first, at most `limit`: just their codes.
 * Reads the next_deadline index; before migration 0054, live battles' meta.
 */
export async function dueBattles(now: number, limit = 50): Promise<string[]> {
  const sb = remote();
  if (sb) {
    if (hasDeadlineColumn()) {
      const { data, error } = await sb
        .from(TABLE)
        .select("code")
        .lte("next_deadline", new Date(now).toISOString())
        .gt("expires_at", new Date(now).toISOString())
        .order("next_deadline", { ascending: true })
        .limit(limit);
      if (!error) return (data ?? []).map((r: { code: string }) => r.code);
      if (!noDeadlineColumn(error)) throw new Error(error.message);
    }
    const { data, error } = await sb
      .from(TABLE)
      .select("code, meta")
      .eq("kind", "pvp")
      .eq("meta->>status", "playing")
      .gt("expires_at", new Date(now).toISOString())
      .limit(DUE_FALLBACK_LIMIT);
    if (error) throw new Error(error.message);
    return dueOf((data ?? []) as { code: string; meta: BattleMeta }[], now, limit);
  }
  const rows = [...memory().entries()].filter(([, row]) => row.expires > now).map(([code, row]) => ({ code, meta: (JSON.parse(row.json) as BattleRecord).meta }));
  return dueOf(rows, now, limit);
}

function dueOf(rows: { code: string; meta: BattleMeta }[], now: number, limit: number): string[] {
  return rows
    .map((r) => ({ code: r.code, at: nextDeadline(r.meta) }))
    .filter((r): r is { code: string; at: number } => r.at !== null && r.at <= now)
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map((r) => r.code);
}
