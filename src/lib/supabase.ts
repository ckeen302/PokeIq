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
/** After the database can't be reached, calls fail at once for this long instead of each waiting it out. */
const BACKOFF_MS = 10000;
let downUntil = 0;
let warnedDown = 0;

/**
 * fetch for the Supabase client: every request gets a timeout, and a network
 * failure (refused, unreachable, timed out) makes the next calls fail fast for
 * a few seconds. Callers already treat a failed call as "no data", so with the
 * database down pages show their empty or unavailable state quickly instead
 * of piling up requests.
 */
export const resilientFetch: typeof fetch = async (input, init) => {
  if (Date.now() < downUntil) throw new TypeError("fetch failed: database unavailable (backing off)");
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const upload = init?.method !== undefined && init.method !== "GET" && init.method !== "HEAD" && url.includes("/storage/");
  const timeout = AbortSignal.timeout(upload ? UPLOAD_TIMEOUT_MS : QUERY_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    if (!init?.signal?.aborted) {
      downUntil = Date.now() + BACKOFF_MS;
      if (Date.now() - warnedDown > 60000) {
        warnedDown = Date.now();
        console.error("[supabase] unreachable, failing fast for a few seconds:", err instanceof Error ? err.message : err);
      }
    }
    throw err;
  }
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
