import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { setShotScores } from "./geo";

/**
 * Players' round scores per screenshot (migration 0038, `geo_round_scores`),
 * so each shot's difficulty follows how players really do on it.
 *
 * Everything here fails open: until the table exists (or without Supabase)
 * nothing is logged and the audit's heuristic ratings stand, so the game
 * plays as before. With POKEIQ_LOCAL_ACCOUNTS=1 (tests, the local E2E run),
 * and in development without Supabase, rounds live in memory.
 */

export type RoundMode = "solo" | "daily" | "challenge";
export interface ShotScoreStat {
  id: string;
  avg: number;
  rounds: number;
}
export interface RoundScoreStore {
  insert(row: { shot: string; score: number; mode: RoundMode }): Promise<void>;
  stats(): Promise<ShotScoreStat[]>;
}

class Unavailable extends Error {}

const globalStore = globalThis as unknown as { __pokeiqRoundScores?: { shot: string; score: number }[] };
const mem = () => (globalStore.__pokeiqRoundScores ??= []);
export function clearMemoryRoundScores() {
  globalStore.__pokeiqRoundScores = [];
  statsUntil = 0;
}

export function memoryRoundScoreStore(): RoundScoreStore {
  return {
    async insert(row) {
      mem().push({ shot: row.shot, score: row.score });
    },
    async stats() {
      const by = new Map<string, { sum: number; n: number }>();
      for (const r of mem()) {
        const s = by.get(r.shot) ?? { sum: 0, n: 0 };
        s.sum += r.score;
        s.n++;
        by.set(r.shot, s);
      }
      return [...by].map(([id, s]) => ({ id, avg: s.sum / s.n, rounds: s.n }));
    },
  };
}

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
let warnedAt = 0;
function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (MISSING.has(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "")) {
    if (Date.now() - warnedAt > 10 * 60_000) console.warn("[geo-round-scores] off until migration 0038_geo_round_scores.sql is applied:", error.message);
    warnedAt = Date.now();
    throw new Unavailable(error.message);
  }
  throw new Error(error.message);
}

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;
export function supabaseRoundScoreStore(sb: Sb): RoundScoreStore {
  return {
    async insert(row) {
      const { error } = await sb.from("geo_round_scores").insert({ shot_id: row.shot, score: row.score, mode: row.mode });
      check(error);
    },
    async stats() {
      const { data, error } = await sb.from("geo_shot_score_stats").select("shot_id, rounds, avg_score").limit(50_000);
      check(error);
      return ((data ?? []) as { shot_id: string; rounds: number; avg_score: number }[]).map((r) => ({ id: r.shot_id, avg: Number(r.avg_score), rounds: Number(r.rounds) }));
    },
  };
}

export function roundScoreStore(): RoundScoreStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryRoundScoreStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseRoundScoreStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryRoundScoreStore() : null;
}

/** Logs a graded round. Never throws: a database problem can't stop a game. */
export async function logRoundScore(row: { shot: string; score: number; mode: RoundMode }, store = roundScoreStore()): Promise<void> {
  if (!store) return;
  try {
    await store.insert(row);
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[geo-round-scores] not logged:", err);
  }
}

/** How long the per-shot averages are trusted before they're read again. */
const STATS_TTL_MS = 10 * 60_000;
let statsUntil = 0;
let loading: Promise<void> | null = null;

/** Brings the shots' player-based difficulty up to date (at most every ten minutes); never throws or waits long. */
export async function syncShotScores(now = Date.now(), store = roundScoreStore()): Promise<void> {
  if (!store || now < statsUntil) return;
  loading ??= (async () => {
    try {
      setShotScores(await store.stats());
    } catch (err) {
      if (!(err instanceof Unavailable)) console.error("[geo-round-scores] averages not read:", err);
    } finally {
      statsUntil = Date.now() + STATS_TTL_MS;
      loading = null;
    }
  })();
  await Promise.race([loading, new Promise((r) => setTimeout(r, 1_500))]);
}
