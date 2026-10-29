import "server-only";
import { getServiceSupabase } from "@/lib/supabase";
import { WORLD_REGION, type GeoAnswer, type GeoSpec } from "@/lib/geo-types";
import { GEO_STREAK_REGIONS, type GeoStreakGuessResponse, type GeoStreakRegion, type GeoStreakResult, type GeoStreakStartResponse } from "@/lib/geo-streak-types";
import { decryptJson, encryptJson, randomId, signToken, verifyToken } from "./crypto";
import { answerFor, planRounds, regionGroupOf } from "./geo";

/**
 * Region Streak: one screenshot, name the region (Kanto to Paldea), no pin.
 * Right keeps the streak alive and deals the next shot; wrong ends the run.
 * Like a standard game, the rounds are planned from a secret seed and the
 * current round travels sealed in a signed token, so the answer never
 * reaches the browser before the pick, and every pick is graded here.
 */

const SPEC: GeoSpec = { region: WORLD_REGION, kind: "streak" };
const STATE_TTL_MS = 3 * 60 * 60 * 1000;
/** A run can't go on past the places on the map. */
const MAX_STREAK = 2000;

type SealedRound = [location: string, region: string | undefined, shot: string, game: string | undefined];
type Planned = ReturnType<typeof planRounds>[number];
const seal = (r: Planned) => encryptJson([r.location, r.region, r.shot, r.game] satisfies SealedRound, "geo-streak");
function unseal(sealed: string | undefined): Planned | null {
  const r = sealed ? decryptJson<SealedRound>(sealed, "geo-streak") : null;
  return Array.isArray(r) ? { location: r[0], region: r[1] ?? undefined, shot: r[2], game: r[3] ?? undefined } : null;
}

export interface StreakState {
  v: 1;
  sid: string;
  seed: string;
  startedAt: number;
  /** Regions named right so far. */
  streak: number;
  /** The current round, sealed. */
  plan: string;
  /** The run ended (a miss, or the map ran out). */
  over?: boolean;
  name?: string;
}

const shotUrl = (id: string) => `/api/geo/shot/${id}`;
export const isStreakRegion = (x: unknown): x is GeoStreakRegion => typeof x === "string" && (GEO_STREAK_REGIONS as readonly string[]).includes(x);

/** Areas the world data files under their own name that are part of a region's games (on top of geo.ts's groups). */
const ALSO_IN: Record<string, GeoStreakRegion> = { Kitakami: "Paldea" };

/** The region a place counts as (DLC areas and the Sevii Islands go with their region). */
export const streakRegionOf = (answer: Pick<GeoAnswer, "region">): GeoStreakRegion | null => {
  const g = regionGroupOf(answer.region);
  return isStreakRegion(g) ? g : (ALSO_IN[answer.region ?? ""] ?? null);
};

/** A seed's rounds in order, only those whose place is in one of the nine regions (kept for the run's next pick). */
const PLANS = new Map<string, Planned[]>();
const PLANS_MAX = 64;
function roundsOf(seed: string): Planned[] {
  let rounds = PLANS.get(seed);
  if (!rounds) {
    rounds = planRounds(SPEC, seed).filter((r) => {
      try {
        return !!streakRegionOf(answerFor(SPEC, r));
      } catch {
        return false;
      }
    });
    if (PLANS.size >= PLANS_MAX) PLANS.delete(PLANS.keys().next().value!);
    PLANS.set(seed, rounds);
  }
  return rounds;
}
/** The run's round at `index` (the plan is deterministic: the same seed always deals the same order). */
const roundAt = (seed: string, index: number): Planned | undefined => roundsOf(seed)[index];

export function startStreak(opts: { name?: string } = {}): GeoStreakStartResponse {
  const seed = randomId();
  const first = roundAt(seed, 0);
  if (!first) throw new Error("No places to play.");
  const state: StreakState = { v: 1, sid: randomId(), seed, startedAt: Date.now(), streak: 0, plan: seal(first), name: opts.name };
  return { token: signToken("geo-streak", state), shot: shotUrl(first.shot), regions: [...GEO_STREAK_REGIONS] };
}

export function readStreak(token: unknown): StreakState | null {
  const state = verifyToken<StreakState>("geo-streak", token);
  if (!state || state.v !== 1 || typeof state.plan !== "string" || Date.now() - state.startedAt > STATE_TTL_MS) return null;
  return state;
}

export type StreakOutcome =
  | { ok: true; claimKey: string; body: GeoStreakGuessResponse; /** The round's screenshot (for the per-shot log; never sent). */ shot: string; /** The place's region (for the stats log). */ region: GeoStreakRegion | null }
  | { ok: false; status: number; error: string };

/** Grades a pick. `timeout`: the clock ran out before a pick (ends the run, like a miss). */
export function gradeStreak(state: StreakState, pick: { region?: string; timeout?: boolean }): StreakOutcome {
  if (state.over) return { ok: false, status: 409, error: "This run is already over." };
  const round = unseal(state.plan);
  if (!round) return { ok: false, status: 409, error: "PokéGuessr was just updated. Start a new run." };
  let answer: GeoAnswer;
  try {
    answer = answerFor(SPEC, round, 0);
  } catch {
    return { ok: false, status: 409, error: "PokéGuessr was just updated. Start a new run." };
  }
  const region = streakRegionOf(answer);
  const correct = !pick.timeout && !!region && pick.region === region;
  const streak = state.streak + (correct ? 1 : 0);
  const index = state.streak + 1;
  const nextRound = correct && streak < MAX_STREAK ? roundAt(state.seed, index) : undefined;
  const done = !correct || !nextRound;
  const next: StreakState = { ...state, streak, plan: nextRound ? seal(nextRound) : state.plan, over: done || undefined };
  const now = Date.now();
  const result: GeoStreakResult | undefined = done ? { sid: state.sid, streak, durationMs: Math.max(1, now - state.startedAt), finishedAt: now } : undefined;
  return {
    ok: true,
    claimKey: `geo-streak:${state.sid}:${state.streak}`,
    shot: round.shot,
    region,
    body: {
      correct,
      ...(pick.timeout ? { timedOut: true } : {}),
      region,
      picked: isStreakRegion(pick.region) ? pick.region : null,
      streak,
      answer,
      token: signToken("geo-streak", next),
      next: nextRound ? { shot: shotUrl(nextRound.shot) } : undefined,
      done,
      resultToken: result ? signToken("geo-streak-result", result) : undefined,
    },
  };
}

export function readStreakResult(token: unknown): GeoStreakResult | null {
  const r = verifyToken<GeoStreakResult>("geo-streak-result", token);
  return r && typeof r.sid === "string" && Number.isInteger(r.streak) && r.streak >= 0 && typeof r.finishedAt === "number" ? r : null;
}

// ---------------------------------------------------------------------------
// Best streak per trainer (migration 0046, `geo_streaks`)
// ---------------------------------------------------------------------------

export interface StreakBest {
  best: number;
  runs: number;
}
export interface StreakStore {
  /** Records a finished run; returns the trainer's best after it. */
  record(key: string, streak: number): Promise<StreakBest>;
  best(key: string): Promise<StreakBest | null>;
}

class Unavailable extends Error {}
const globalStore = globalThis as unknown as { __pokeiqStreaks?: Map<string, StreakBest> };
const mem = () => (globalStore.__pokeiqStreaks ??= new Map());
export function clearMemoryStreaks() {
  globalStore.__pokeiqStreaks = new Map();
}

export function memoryStreakStore(): StreakStore {
  return {
    async record(key, streak) {
      const cur = mem().get(key) ?? { best: 0, runs: 0 };
      const next = { best: Math.max(cur.best, streak), runs: cur.runs + 1 };
      mem().set(key, next);
      return next;
    },
    async best(key) {
      return mem().get(key) ?? null;
    },
  };
}

const MISSING = new Set(["42P01", "PGRST205", "PGRST204", "42703", "42883"]);
let warnedAt = 0;
function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (MISSING.has(error.code ?? "") || /does not exist|schema cache/i.test(error.message ?? "")) {
    if (Date.now() - warnedAt > 10 * 60_000) console.warn("[geo-streak] best streaks off until migration 0046_geo_streak.sql is applied:", error.message);
    warnedAt = Date.now();
    throw new Unavailable(error.message);
  }
  throw new Error(error.message);
}

type Sb = NonNullable<ReturnType<typeof getServiceSupabase>>;
export function supabaseStreakStore(sb: Sb): StreakStore {
  const read = async (key: string): Promise<StreakBest | null> => {
    const { data, error } = await sb.from("geo_streaks").select("best, runs").eq("player_key", key).maybeSingle();
    check(error);
    return data ? { best: Number((data as { best: number }).best), runs: Number((data as { runs: number }).runs) } : null;
  };
  return {
    async record(key, streak) {
      const cur = (await read(key)) ?? { best: 0, runs: 0 };
      const next = { best: Math.max(cur.best, streak), runs: cur.runs + 1 };
      const { error } = await sb.from("geo_streaks").upsert({ player_key: key, best: next.best, runs: next.runs, last: streak, updated_at: new Date().toISOString() }, { onConflict: "player_key" });
      check(error);
      return next;
    },
    best: read,
  };
}

export function streakStore(): StreakStore | null {
  if (process.env.POKEIQ_LOCAL_ACCOUNTS === "1") return memoryStreakStore();
  const sb = getServiceSupabase();
  if (sb) return supabaseStreakStore(sb);
  return process.env.NODE_ENV !== "production" ? memoryStreakStore() : null;
}

/** Records a trainer's finished run; null when nothing is stored (no store, or the table isn't there yet). Never throws. */
export async function recordStreakRun(key: string, streak: number, store = streakStore()): Promise<StreakBest | null> {
  if (!store) return null;
  try {
    return await store.record(key, streak);
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[geo-streak] run not recorded:", err);
    return null;
  }
}

/** A trainer's best region streak, or null. Never throws. */
export async function bestStreakOf(key: string, store = streakStore()): Promise<StreakBest | null> {
  if (!store) return null;
  try {
    return await store.best(key);
  } catch (err) {
    if (!(err instanceof Unavailable)) console.error("[geo-streak] best not read:", err);
    return null;
  }
}
