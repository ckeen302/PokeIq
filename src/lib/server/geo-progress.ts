import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import {
  GEO_ACHIEVEMENTS,
  GEO_MASTERY_SCORE,
  GEO_PERFECT_SCORE,
  type GeoAchievementState,
  type GeoMasteryRow,
  type GeoProgress,
  type GeoProgressMetrics,
} from "@/lib/geo-achievements";
import { geoDivisionOf, utcDay } from "@/lib/geo-ranked";
import { GEO_WEEKLY_BOARD_RE, geoWeekOf } from "@/lib/geo-weekly";
import { geoMasteryIndex } from "./geo";
import { roundScoreStore, RoundScoresUnavailable, type PlayerRoundRow } from "./geo-round-scores";
import { bestStreakOf } from "./geo-streak";
import { geoRankedKey, geoRankedStandingOf } from "./geo-ranked";

/**
 * A trainer's PokéGuessr achievements and mastery, worked out from what the
 * server has logged: their rounds (geo_round_scores, keyed by account or
 * device), their best Region Streak, their ranked rating and the Weekly
 * Challenge boards. With migration 0048 each achievement is recorded the
 * first time it's met (geo_achievements), so it stays earned; without it they
 * are simply worked out each time. Everything fails open.
 */

export interface GeoTrainer {
  /** geoStatsKey(`u:<id>`) or geoStatsKey(`d:<device>`). */
  key: string;
  /** Signed-in trainers: ranked and the weekly boards are read for them. */
  userId?: string;
  username?: string;
}

const DAY_MS = 86_400_000;

/** The longest run of consecutive UTC days in a set of days (YYYY-MM-DD). */
export function longestDayRun(days: Iterable<string>): number {
  const sorted = [...new Set(days)].map((d) => Date.parse(`${d}T00:00:00Z`)).filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] - sorted[i - 1] === DAY_MS ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** The metrics the achievements read, from a trainer's logged rounds (the extras come from elsewhere). */
export function metricsFromRounds(rows: readonly PlayerRoundRow[]): GeoProgressMetrics {
  let rounds = 0;
  let perfectRounds = 0;
  const regions: Record<string, { rounds: number; avg: number }> = {};
  const sums = new Map<string, number>();
  const runs = new Map<string, number>();
  const dailyDays = new Set<string>();
  for (const r of rows) {
    if (r.kind === "region-streak" || r.kind === "streak") {
      // Places in a row: the right picks of a run (a streak run ends at its first miss).
      if (r.run && r.hit) runs.set(r.run, (runs.get(r.run) ?? 0) + 1);
    }
    if (r.kind === "region-streak") continue;
    rounds++;
    if (r.score >= GEO_PERFECT_SCORE) perfectRounds++;
    if (r.region) {
      const x = (regions[r.region] ??= { rounds: 0, avg: 0 });
      x.rounds++;
      sums.set(r.region, (sums.get(r.region) ?? 0) + r.score);
    }
    if (r.kind === "daily" && r.at) dailyDays.add(utcDay(r.at));
  }
  for (const [region, x] of Object.entries(regions)) x.avg = (sums.get(region) ?? 0) / x.rounds;
  return {
    rounds,
    perfectRounds,
    bestStreak: Math.max(0, ...runs.values()),
    dailyStreakBest: longestDayRun(dailyDays),
    rankedDivision: null,
    weeklyBestPlace: null,
    regions,
  };
}

/** Each region's places scored GEO_MASTERY_SCORE+ at least once (any map: a Kanto place counts on the world map too). */
export function masteryFromRounds(rows: readonly PlayerRoundRow[], index = geoMasteryIndex()): GeoMasteryRow[] {
  const done = new Set<string>();
  for (const r of rows) {
    if (r.kind === "region-streak" || !r.shot || r.score < GEO_MASTERY_SCORE) continue;
    const area = index.areaOfShot.get(r.shot);
    if (area) done.add(area);
  }
  return index.regions.map((region) => ({
    id: region.id,
    name: region.name,
    mastered: [...region.areas].filter((a) => done.has(a)).length,
    places: region.areas.size,
  }));
}

/** The achievements met by these metrics, plus the ones recorded before. */
export function achievementStates(m: GeoProgressMetrics, recorded: ReadonlyMap<string, number> = new Map()): GeoAchievementState[] {
  return GEO_ACHIEVEMENTS.map((a) => {
    const p = a.progress(m);
    const at = recorded.get(a.id);
    const earned = p.met || at !== undefined;
    return {
      id: a.id,
      earned,
      ...(at !== undefined ? { earnedAt: at } : {}),
      have: earned ? p.need : p.have,
      need: p.need,
      ...(p.note && !earned ? { note: p.note } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// The recorded achievements (migration 0048), or memory for tests and local runs
// ---------------------------------------------------------------------------

interface AchievementStore {
  read(key: string): Promise<Map<string, number>>;
  add(key: string, ids: string[]): Promise<void>;
}
class Unavailable extends Error {}
const memory = globalThis as unknown as { __pokeiqGeoAchievements?: Map<string, Map<string, number>> };
function memoryStore(): AchievementStore {
  const db = (memory.__pokeiqGeoAchievements ??= new Map());
  return {
    async read(key) {
      return new Map(db.get(key) ?? []);
    },
    async add(key, ids) {
      const mine = db.get(key) ?? new Map<string, number>();
      for (const id of ids) if (!mine.has(id)) mine.set(id, Date.now());
      db.set(key, mine);
    },
  };
}
let warnedAt = 0;
function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (["42P01", "PGRST205", "PGRST204", "42703"].includes(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "")) {
    if (Date.now() - warnedAt > 10 * 60_000) console.warn("[geo-progress] achievements aren't recorded until migration 0048_geo_achievements.sql is applied:", error.message);
    warnedAt = Date.now();
    throw new Unavailable(error.message);
  }
  throw new Error(error.message);
}
function supabaseStore(sb: NonNullable<ReturnType<typeof getServiceSupabase>>): AchievementStore {
  return {
    async read(key) {
      const { data, error } = await sb.from("geo_achievements").select("achievement_id, earned_at").eq("player_key", key).limit(200);
      check(error);
      return new Map(((data ?? []) as { achievement_id: string; earned_at: string }[]).map((r) => [r.achievement_id, Date.parse(r.earned_at)]));
    },
    async add(key, ids) {
      const { error } = await sb
        .from("geo_achievements")
        .upsert(ids.map((id) => ({ player_key: key, achievement_id: id })), { onConflict: "player_key,achievement_id", ignoreDuplicates: true });
      check(error);
    },
  };
}
function achievementStore(): AchievementStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryStore() : null;
}
const quiet = async <T>(what: string, p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch (err) {
    if (!(err instanceof Unavailable) && !(err instanceof RoundScoresUnavailable)) console.error(`[geo-progress] ${what}:`, err);
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// The Weekly Challenge boards
// ---------------------------------------------------------------------------

/** The best place a name took on a finished week's board (ties on score go to the faster game), or null. */
async function weeklyBestPlace(username: string, now: number): Promise<number | null> {
  const sb = getServiceSupabase();
  if (!sb || process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return null;
  const current = geoWeekOf(now);
  const { data, error } = await sb
    .from("geo_runs")
    .select("mode, score, duration_ms")
    .like("mode", "weekly:%")
    .ilike("player_name", username.replace(/[%_\\]/g, "\\$&"))
    .order("created_at", { ascending: false })
    .limit(26);
  if (error) throw new Error(error.message);
  let best: number | null = null;
  for (const run of (data ?? []) as { mode: string; score: number; duration_ms: number }[]) {
    const week = GEO_WEEKLY_BOARD_RE.exec(run.mode)?.[1];
    if (!week || week >= current) continue; // only finished weeks
    const ahead = await sb
      .from("geo_runs")
      .select("id", { count: "exact", head: true })
      .eq("mode", run.mode)
      .or(`score.gt.${run.score},and(score.eq.${run.score},duration_ms.lt.${run.duration_ms})`);
    if (ahead.error) throw new Error(ahead.error.message);
    const place = (ahead.count ?? 0) + 1;
    best = best === null ? place : Math.min(best, place);
    if (best === 1) break;
  }
  return best;
}

// ---------------------------------------------------------------------------

/** A trainer's achievements and mastery. `record`: write newly met achievements (0048). Never throws. */
export async function geoProgressFor(who: GeoTrainer, opts: { now?: number; record?: boolean } = {}): Promise<GeoProgress> {
  const now = opts.now ?? Date.now();
  const rounds = roundScoreStore();
  const store = achievementStore();
  const [rows, recorded, regionStreak, standing, weekly] = await Promise.all([
    rounds ? quiet("rounds", rounds.ofPlayer(who.key), [] as PlayerRoundRow[]) : ([] as PlayerRoundRow[]),
    store ? quiet("recorded", store.read(who.key), new Map<string, number>()) : new Map<string, number>(),
    who.userId ? bestStreakOf(who.key) : null,
    who.userId ? geoRankedStandingOf(geoRankedKey(`u:${who.userId}`), utcDay(now)) : null,
    who.username ? quiet("weekly boards", weeklyBestPlace(who.username, now), null) : null,
  ]);
  const metrics = metricsFromRounds(rows);
  metrics.bestStreak = Math.max(metrics.bestStreak, regionStreak?.best ?? 0);
  if (standing && standing.games > 0) metrics.rankedDivision = geoDivisionOf(standing.elo).index;
  metrics.weeklyBestPlace = weekly;
  const achievements = achievementStates(metrics, recorded);
  const fresh = achievements.filter((a) => a.earned && !recorded.has(a.id)).map((a) => a.id);
  if (store && opts.record !== false && fresh.length) await quiet("record", store.add(who.key, fresh), undefined);
  return { achievements, mastery: masteryFromRounds(rows), rounds: metrics.rounds, perfectRounds: metrics.perfectRounds };
}
