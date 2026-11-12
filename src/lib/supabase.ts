import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the SERVICE ROLE key.
 *
 * Writes (runs, answer claims, calibration events) only ever happen through
 * our API after server-side grading, so the public anon key gets read-only
 * access via RLS — nobody can insert a fake score straight into Postgres.
 *
 * Deliberately optional: without env vars the whole game still works; only
 * persistence (leaderboards, calibration) is disabled.
 */

let client: SupabaseClient | null | undefined;

/** A query that takes longer than this is given up on: a slow database must not hang a page. */
const QUERY_TIMEOUT_MS = 5000;
/** Storage uploads (avatars, screenshots) are allowed longer. */
const UPLOAD_TIMEOUT_MS = 20000;
/** Network failures in a row that mean the database is down rather than a blip. */
const FAILURES_TO_BACK_OFF = 3;
/** Once it's down, calls fail at once for this long instead of each waiting it out. */
const BACKOFF_MS = 10000;
let failures = 0;
let downUntil = 0;
let warnedDown = 0;

/**
 * Named AbortError on purpose: supabase-js retries a failed read three times
 * with 1 + 2 + 4 s waits, unless the request was aborted. With the database
 * down that turned every read into a 7-second stall; this way a failed read
 * returns its error at once and the caller shows its empty or unavailable state.
 */
class DatabaseUnavailable extends Error {
  override name = "AbortError";
}

function failed(reason: string): never {
  failures += 1;
  if (failures >= FAILURES_TO_BACK_OFF) {
    downUntil = Date.now() + BACKOFF_MS;
    if (Date.now() - warnedDown > 60000) {
      warnedDown = Date.now();
      console.error(`[supabase] unreachable (${reason}), failing fast for ${BACKOFF_MS / 1000} s at a time`);
    }
  }
  throw new DatabaseUnavailable(`database unavailable: ${reason}`);
}

/**
 * fetch for the Supabase client: every request has a timeout, a failure is
 * returned at once rather than retried, and after a few network failures in a
 * row calls fail immediately for a few seconds, so a dead database can't pile
 * up waiting requests on a busy day. A 503 / 520 (the database restarting or
 * paused) is passed on as a 502, which supabase-js doesn't retry either.
 */
export const resilientFetch: typeof fetch = async (input, init) => {
  if (Date.now() < downUntil) throw new DatabaseUnavailable("database unavailable (backing off)");
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const upload = init?.method !== undefined && init.method !== "GET" && init.method !== "HEAD" && url.includes("/storage/");
  const timeout = AbortSignal.timeout(upload ? UPLOAD_TIMEOUT_MS : QUERY_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(input, { ...init, signal });
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    return failed(err instanceof Error ? (err.name === "TimeoutError" ? "timed out" : err.message) : String(err));
  }
  failures = 0;
  if (res.status === 503 || res.status === 520) return new Response(res.body, { status: 502, statusText: `Upstream ${res.status}`, headers: res.headers });
  return res;
};

export function getServiceSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false }, global: { fetch: resilientFetch } }) : null;
  return client;
}

export interface LeaderboardRow {
  id: string;
  player_name: string;
  module: string;
  format: string;
  difficulty: string;
  daily_date: string | null;
  score: number;
  correct: number;
  total: number;
  best_streak: number;
  pokeiq: number;
  duration_ms: number;
  created_at: string;
}
