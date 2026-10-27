import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { computeStats } from "@/lib/battle/analysis/stats";
import { aggregateInsights, INSIGHTS_WINDOW, summaryFromStats, type BattleSummary, type InsightTotals, type Insights, type RatingPoint } from "@/lib/battle/insights";
import { RankedUnavailable } from "../ranked";
import { recordStore, type ResultEntry } from "./records";
import { ReplaysUnavailable, replayStore } from "./replays";

/**
 * A trainer's team insights (lib/battle/insights.ts), from their battle
 * records and saved replays. Each battle is summarised once, the first time
 * the trainer's insights are asked for (a few dozen per visit, so a long
 * history fills in over visits instead of in one slow request), and kept;
 * the sums are done by the database. Kept in memory for a few minutes.
 *
 * Summaries live in Supabase (migration 0041_battle_insights.sql), or in
 * memory with POKEIQ_LOCAL_ACCOUNTS=1 and in development without Supabase.
 * Until the migration is applied, `insightsAvailable()` is false and the
 * links to the insights stay hidden.
 */

/** Battles summarised per visit at most. */
export const BACKFILL_PER_VISIT = 25;
const CACHE_MS = 5 * 60_000;

export interface InsightsStore {
  available(): Promise<boolean>;
  /** Which of `codes` already have a summary for `key`. */
  summarised(key: string, codes: string[]): Promise<Set<string>>;
  save(rows: BattleSummary[]): Promise<void>;
  totals(key: string, format: string | null, limit: number): Promise<InsightTotals>;
  /** GXE after each ranked game (since the migration). */
  gxeHistory(key: string, format: string): Promise<{ at: number; games: number; rating: number; gxe: number }[]>;
}

export class InsightsUnavailable extends Error {}

// ---- memory -------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqInsights?: Map<string, BattleSummary> };

export function memoryInsightsStore(): InsightsStore {
  const db = (globalStore.__pokeiqInsights ??= new Map());
  return {
    async available() {
      return true;
    },
    async summarised(key, codes) {
      return new Set(codes.filter((c) => db.has(`${c}|${key}`)));
    },
    async save(rows) {
      for (const r of rows) if (!db.has(`${r.code}|${r.key}`)) db.set(`${r.code}|${r.key}`, structuredClone(r));
    },
    async totals(key, format, limit) {
      return aggregateInsights(
        [...db.values()].filter((r) => r.key === key && (!format || r.format === format)),
        limit
      );
    },
    async gxeHistory() {
      return [];
    },
  };
}

export function clearMemoryInsights() {
  globalStore.__pokeiqInsights = undefined;
  cache.clear();
}

// ---- Supabase -------------------------------------------------------------------

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;
let knownAvailable = 0;

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    if (Date.now() >= missingUntil) console.warn("[insights] team insights are off until migration 0041_battle_insights.sql is applied:", error.message);
    missingUntil = Date.now() + RECHECK_MS;
    throw new InsightsUnavailable(error.message);
  }
  throw new Error(error.message);
}

export function supabaseInsightsStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): InsightsStore {
  const guard = () => {
    if (Date.now() < missingUntil) throw new InsightsUnavailable("migration 0041 not applied");
  };
  return {
    async available() {
      if (Date.now() < missingUntil) return false;
      if (Date.now() < knownAvailable) return true;
      try {
        const { error } = await sb.from("battle_player_summaries").select("battle_code", { head: true, count: "estimated" }).limit(1);
        check(error);
        knownAvailable = Date.now() + RECHECK_MS;
        return true;
      } catch {
        return false;
      }
    },
    async summarised(key, codes) {
      guard();
      if (!codes.length) return new Set();
      const { data, error } = await sb.from("battle_player_summaries").select("battle_code").eq("player_key", key).in("battle_code", codes);
      check(error);
      return new Set(((data ?? []) as { battle_code: string }[]).map((r) => r.battle_code));
    },
    async save(rows) {
      guard();
      if (!rows.length) return;
      const { error } = await sb.from("battle_player_summaries").upsert(
        rows.map((r) => ({
          battle_code: r.code,
          player_key: r.key,
          format: r.format,
          ranked: r.ranked,
          result: r.result,
          has_replay: r.hasReplay,
          lead: r.lead,
          team: r.team.slice(0, 24),
          foes: r.foes.slice(0, 24),
          ko_by: r.koBy.slice(0, 24),
          played_at: new Date(r.at).toISOString(),
        })),
        { onConflict: "battle_code,player_key", ignoreDuplicates: true }
      );
      check(error);
    },
    async totals(key, format, limit) {
      guard();
      const { data, error } = await sb.rpc("battle_insights", { p_key: key, p_format: format, p_limit: limit });
      check(error);
      const d = (data ?? {}) as Record<string, unknown>;
      const rows = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : []);
      return {
        battles: Number(d.battles ?? 0),
        wins: Number(d.wins ?? 0),
        leads: rows(d.leads).map((r) => ({ species: String(r.species), games: Number(r.games), wins: Number(r.wins) })),
        mons: rows(d.mons).map((r) => ({ species: String(r.species), games: Number(r.games), wins: Number(r.wins) })),
        threats: rows(d.threats).map((r) => ({ species: String(r.species), games: Number(r.games), losses: Number(r.losses), kos: Number(r.kos) })),
      };
    },
    async gxeHistory(key, format) {
      guard();
      const { data, error } = await sb
        .from("battle_rating_history")
        .select("games, rating, gxe, created_at")
        .eq("player_key", key)
        .eq("format", format)
        .order("created_at", { ascending: false })
        .limit(INSIGHTS_WINDOW);
      check(error);
      return ((data ?? []) as { games: number; rating: number; gxe: number | null; created_at: string }[])
        .filter((r) => r.gxe !== null)
        .map((r) => ({ at: Date.parse(r.created_at), games: r.games, rating: r.rating, gxe: Number(r.gxe) }))
        .reverse();
    },
  };
}

export function insightsStore(): InsightsStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryInsightsStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseInsightsStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryInsightsStore() : null;
}

/** Whether team insights can be shown here (the migration is applied): the links to them show only then. */
export async function insightsAvailable(): Promise<boolean> {
  const store = insightsStore();
  return !!store && !!recordStore() && (await store.available().catch(() => false));
}

// ---- the insights ----------------------------------------------------------------

/** The summary of one battle for its trainer, from its replay (null when it can't be read). */
async function summarise(entry: ResultEntry): Promise<BattleSummary> {
  const base = { code: entry.code, key: entry.key, format: entry.format, ranked: entry.ranked, result: entry.result, at: entry.at };
  const empty: BattleSummary = { ...base, hasReplay: false, lead: null, team: [], foes: [], koBy: [] };
  let replay;
  try {
    replay = await replayStore()?.get(entry.code);
  } catch (err) {
    if (err instanceof ReplaysUnavailable) throw err;
    return empty;
  }
  if (!replay) return empty;
  const seat = replay.players[0] === entry.name && replay.players[1] !== entry.name ? 0 : replay.players[1] === entry.name && replay.players[0] !== entry.name ? 1 : null;
  if (seat === null) return empty;
  try {
    return summaryFromStats(computeStats(replay.log), seat, base);
  } catch {
    return empty;
  }
}

const cache = new Map<string, { at: number; value: Promise<Insights | null> }>();

/**
 * A trainer's insights in `format` (or across every format): null when
 * insights or records aren't available here. Summarises up to
 * BACKFILL_PER_VISIT of their battles that have none yet.
 */
export function playerInsights(key: string, format: string | null): Promise<Insights | null> {
  const id = `${key}|${format ?? "*"}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = computeInsights(key, format);
  cache.set(id, { at: Date.now(), value });
  value.catch(() => cache.delete(id));
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

async function computeInsights(key: string, format: string | null): Promise<Insights | null> {
  const store = insightsStore();
  const records = recordStore();
  if (!store || !records) return null;
  try {
    const battles = await records.battles(key, format, INSIGHTS_WINDOW);
    const have = await store.summarised(
      key,
      battles.map((b) => b.code)
    );
    const missing = battles.filter((b) => !have.has(b.code));
    const now = missing.slice(0, BACKFILL_PER_VISIT);
    if (now.length) await store.save(await Promise.all(now.map(summarise)));
    const totals = await store.totals(key, format, INSIGHTS_WINDOW);
    const trend: RatingPoint[] = [];
    if (format) {
      const ranked = battles.filter((b) => b.ranked && b.ratingAfter !== undefined).reverse();
      const gxe = await store.gxeHistory(key, format).catch(() => []);
      // A game's GXE, where the history has it: matched by when it was played (the history row is written as the game is counted).
      // Where it started: the rating before the oldest of these games.
      if (ranked[0]?.ratingBefore !== undefined) trend.push({ at: ranked[0].at, rating: ranked[0].ratingBefore });
      for (const b of ranked) {
        const g = gxe.find((x) => Math.abs(x.at - b.at) < 60_000 && x.rating === b.ratingAfter);
        trend.push({ at: b.at, rating: b.ratingAfter!, ...(g ? { gxe: g.gxe } : {}) });
      }
    }
    return { ...totals, format, pending: missing.length - now.length, trend };
  } catch (err) {
    if (err instanceof InsightsUnavailable || err instanceof ReplaysUnavailable) return null;
    if (err instanceof RankedUnavailable) return null;
    throw err;
  }
}
