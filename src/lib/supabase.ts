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

export function getServiceSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
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
