/**
 * Optional Supabase persistence. When env vars are absent the app degrades
 * gracefully to an in-process leaderboard (see lib/leaderboard-store).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client =
    url && anonKey
      ? createClient(url, anonKey, { auth: { persistSession: false } })
      : null;
  return client;
}

export function supabaseConfigured(): boolean {
  return getSupabase() !== null;
}

let adminClient: SupabaseClient | null | undefined;

/**
 * Service-role client for auth tables (profiles/sessions/user_stats).
 * Server-only: the service key bypasses RLS, so those tables are locked to
 * it and the anon key can never read password or session hashes.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClient !== undefined) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  adminClient =
    url && serviceKey
      ? createClient(url, serviceKey, { auth: { persistSession: false } })
      : null;
  return adminClient;
}
