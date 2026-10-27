import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { PLAY_FORMAT_INFO, type BattleRatings } from "@/lib/battle/play";
import { customName } from "@/lib/battle/custom-rules";
import { outcomeOf, type BattleFormatRecord, type BattleOutcome, type BattleProfile, type BattleRecentEntry } from "@/lib/battle/profile";
import { RankedUnavailable } from "../ranked";
import { ladderStore } from "./ladder";
import { memoryReplayStore } from "./replays";
import type { BattleMeta } from "./store";

/**
 * Battle records: one row per trainer per finished live battle (by ladder
 * key, an HMAC; only trainers the server knows by an account or signed id
 * have one), for wins and losses per format and the latest battles on their
 * profile. Written once per battle when it's settled (keyed by the battle's
 * code and the trainer, so a second write changes nothing).
 *
 * Records live in Supabase (`battle_results`, migration 0018), or in memory
 * with POKEIQ_LOCAL_ACCOUNTS=1 and in development without Supabase.
 */

export interface ResultEntry {
  code: string;
  key: string;
  format: BattleMeta["format"];
  formatName: string;
  name: string;
  opponent: string;
  result: BattleOutcome;
  ranked: boolean;
  ratingBefore?: number;
  ratingAfter?: number;
  at: number;
}

export interface RecordStore {
  record(entries: ResultEntry[]): Promise<void>;
  /** Wins, losses and draws per format, and the latest `limit` battles. */
  profile(key: string, limit: number): Promise<{ formats: BattleFormatRecord[]; recent: BattleRecentEntry[] }>;
  /** The trainer's latest `limit` battles (in `format`, or all), newest first: for their insights. */
  battles(key: string, format: string | null, limit: number): Promise<ResultEntry[]>;
}

/** The records a finished live battle makes: one per seat the server knows (none for a no contest). */
export function resultsOf(meta: BattleMeta, ratings: BattleRatings | undefined, at: number): ResultEntry[] {
  if (meta.kind !== "pvp" || !meta.end || meta.end.reason === "nocontest" || meta.seats.length !== 2) return [];
  const info = PLAY_FORMAT_INFO[meta.format];
  const formatName = meta.rules ? customName(meta.rules) : info.name;
  const winner = meta.end.winner;
  return meta.seats.flatMap((s, i) => {
    if (!s.player) return [];
    const seat = i as 0 | 1;
    const entry: ResultEntry = {
      code: meta.code,
      key: s.player,
      format: meta.format,
      formatName,
      name: s.name,
      opponent: meta.seats[1 - seat].name,
      result: outcomeOf(seat, winner),
      ranked: !!meta.ranked,
      at,
    };
    if (ratings) {
      entry.ratingBefore = ratings[seat].before;
      entry.ratingAfter = ratings[seat].after;
    }
    return [entry];
  });
}

const recentOf = (e: ResultEntry, replay: boolean): BattleRecentEntry => {
  const r: BattleRecentEntry = { code: e.code, format: e.format, formatName: e.formatName, name: e.name, opponent: e.opponent, result: e.result, ranked: e.ranked, replay, at: e.at };
  if (e.ratingBefore !== undefined) r.ratingBefore = e.ratingBefore;
  if (e.ratingAfter !== undefined) r.ratingAfter = e.ratingAfter;
  return r;
};

// ---- memory -------------------------------------------------------------------

const globalStore = globalThis as unknown as { __pokeiqBattleResults?: Map<string, ResultEntry> };

export function memoryRecordStore(): RecordStore {
  const db = (globalStore.__pokeiqBattleResults ??= new Map());
  return {
    async record(entries) {
      for (const e of entries) if (!db.has(`${e.code}|${e.key}`)) db.set(`${e.code}|${e.key}`, { ...e });
    },
    async profile(key, limit) {
      const mine = [...db.values()].filter((e) => e.key === key).sort((a, b) => b.at - a.at);
      const byFormat = new Map<string, BattleFormatRecord>();
      for (const e of mine) {
        const f = byFormat.get(e.format) ?? { format: e.format, formatName: e.formatName, wins: 0, losses: 0, draws: 0 };
        f[e.result === "win" ? "wins" : e.result === "loss" ? "losses" : "draws"] += 1;
        byFormat.set(e.format, f);
      }
      const replays = memoryReplayStore();
      const recent = await Promise.all(mine.slice(0, limit).map(async (e) => recentOf(e, !!(await replays.get(e.code)))));
      return { formats: [...byFormat.values()], recent };
    },
    async battles(key, format, limit) {
      return [...db.values()]
        .filter((e) => e.key === key && (!format || e.format === format))
        .sort((a, b) => b.at - a.at)
        .slice(0, limit)
        .map((e) => ({ ...e }));
    },
  };
}

export function clearMemoryRecords() {
  globalStore.__pokeiqBattleResults = undefined;
}

// ---- Supabase -------------------------------------------------------------------

const MISSING = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);
const RECHECK_MS = 60_000;
let missingUntil = 0;

function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (MISSING.has(error.code ?? "")) {
    missingUntil = Date.now() + RECHECK_MS;
    throw new RankedUnavailable(error.message);
  }
  throw new Error(error.message);
}

export function supabaseRecordStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): RecordStore {
  const guard = () => {
    if (Date.now() < missingUntil) throw new RankedUnavailable("migration 0018 not applied");
  };
  return {
    async record(entries) {
      if (!entries.length) return;
      guard();
      const { error } = await sb.from("battle_results").upsert(
        entries.map((e) => ({
          battle_code: e.code,
          player_key: e.key,
          format: e.format,
          format_name: e.formatName,
          name: e.name,
          opponent: e.opponent,
          result: e.result,
          ranked: e.ranked,
          rating_before: e.ratingBefore ?? null,
          rating_after: e.ratingAfter ?? null,
        })),
        { onConflict: "battle_code,player_key", ignoreDuplicates: true }
      );
      check(error);
    },
    async profile(key, limit) {
      guard();
      const { data, error } = await sb.rpc("battle_profile", { p_key: key, p_limit: limit });
      check(error);
      const out = (data ?? {}) as { formats?: Record<string, unknown>[]; recent?: Record<string, unknown>[] };
      return {
        formats: (out.formats ?? []).map((f) => ({
          format: String(f.format) as BattleFormatRecord["format"],
          formatName: String(f.format_name),
          wins: Number(f.wins),
          losses: Number(f.losses),
          draws: Number(f.draws),
        })),
        recent: (out.recent ?? []).map((r) => {
          const entry: BattleRecentEntry = {
            code: String(r.battle_code),
            format: String(r.format) as BattleRecentEntry["format"],
            formatName: String(r.format_name),
            name: String(r.name),
            opponent: String(r.opponent),
            result: String(r.result) as BattleOutcome,
            ranked: !!r.ranked,
            replay: !!r.replay,
            at: Date.parse(String(r.created_at)),
          };
          if (r.rating_before !== null && r.rating_before !== undefined) entry.ratingBefore = Number(r.rating_before);
          if (r.rating_after !== null && r.rating_after !== undefined) entry.ratingAfter = Number(r.rating_after);
          return entry;
        }),
      };
    },
    async battles(key, format, limit) {
      guard();
      let q = sb
        .from("battle_results")
        .select("battle_code, format, format_name, name, opponent, result, ranked, rating_before, rating_after, created_at")
        .eq("player_key", key);
      if (format) q = q.eq("format", format);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
      check(error);
      return ((data ?? []) as Record<string, unknown>[]).map((r) => {
        const e: ResultEntry = {
          code: String(r.battle_code),
          key,
          format: String(r.format) as ResultEntry["format"],
          formatName: String(r.format_name),
          name: String(r.name),
          opponent: String(r.opponent),
          result: String(r.result) as BattleOutcome,
          ranked: !!r.ranked,
          at: Date.parse(String(r.created_at)),
        };
        if (r.rating_before !== null && r.rating_before !== undefined) e.ratingBefore = Number(r.rating_before);
        if (r.rating_after !== null && r.rating_after !== undefined) e.ratingAfter = Number(r.rating_after);
        return e;
      });
    },
  };
}

export function recordStore(): RecordStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryRecordStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseRecordStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryRecordStore() : null;
}

/**
 * A trainer's battle profile: their record per format with their ladder
 * standing merged in, and their latest battles. Null when neither records
 * nor the ladder are available here (the migration).
 */
export async function battleProfile(key: string, limit = 20): Promise<BattleProfile | null> {
  const records = recordStore();
  const ladder = ladderStore();
  if (!records && !ladder) return null;
  let available = false;
  let base: { formats: BattleFormatRecord[]; recent: BattleRecentEntry[] } = { formats: [], recent: [] };
  try {
    if (records) {
      base = await records.profile(key, limit);
      available = true;
    }
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) throw err;
  }
  try {
    for (const { format, standing } of ladder ? await ladder.standings(key) : []) {
      available = true;
      let f = base.formats.find((x) => x.format === format);
      if (!f) {
        f = { format, formatName: PLAY_FORMAT_INFO[format].name, wins: 0, losses: 0, draws: 0 };
        base.formats.push(f);
      }
      f.rating = standing.rating;
      f.ratedGames = standing.games;
      if (standing.rd !== undefined) f.rd = standing.rd;
      if (standing.gxe !== undefined) f.gxe = standing.gxe;
      f.position = standing.position;
    }
  } catch (err) {
    if (!(err instanceof RankedUnavailable)) throw err;
  }
  if (!available) return null;
  base.formats.sort((a, b) => b.wins + b.losses + b.draws - (a.wins + a.losses + a.draws));
  return base;
}
