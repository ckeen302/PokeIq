import "server-only";
import { createHash } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";

/**
 * Single-use claims ("has answer #3 of session X been graded yet?").
 *
 * Session state lives in signed tokens, so without this a player could
 * replay an older token to re-answer a question after seeing the solution.
 * Each grading claims `ans:<sid>:<index>` exactly once.
 *
 * Backed by Postgres (unique primary key) when Supabase is configured —
 * correct across serverless instances — and by an in-process TTL map
 * otherwise (correct for single-instance / local deployments).
 */

const memory = new Map<string, number>();
const MEMORY_TTL_MS = 3 * 60 * 60 * 1000;

function claimInMemory(key: string): boolean {
  const now = Date.now();
  if (memory.size > 50_000) {
    for (const [k, exp] of memory) if (exp < now) memory.delete(k);
  }
  const existing = memory.get(key);
  if (existing && existing > now) return false;
  memory.set(key, now + MEMORY_TTL_MS);
  return true;
}

export async function claimOnce(key: string): Promise<boolean> {
  // Always check locally first: cheap, and catches same-instance replays.
  if (!claimInMemory(key)) return false;
  const supabase = getServiceSupabase();
  if (!supabase) return true;
  const { error } = await supabase.from("token_claims").insert({ key });
  if (!error) return true;
  if (error.code === "23505") return false; // unique_violation: already claimed elsewhere
  console.error("[replay-guard] claim failed, allowing:", error.message);
  return true;
}

// ---------------------------------------------------------------------------
// Idempotent retries
// ---------------------------------------------------------------------------

/*
 * A claim is spent before the response reaches the player, so a request
 * whose response was lost would otherwise 409 on retry and strand the run.
 * The graded response is kept briefly (per instance) and replayed for an
 * identical request — same token, same choice — but never for a different one.
 */

const responses = new Map<string, { fingerprint: string; body: unknown; expires: number }>();
const RESPONSE_TTL_MS = 10 * 60 * 1000;
const MAX_RESPONSES = 5_000;

export function requestFingerprint(...parts: (string | null)[]): string {
  return createHash("sha256")
    .update(parts.map((p) => (p === null ? "\u0000null" : p)).join("\u0000"))
    .digest("base64url");
}

export function rememberResponse(key: string, fingerprint: string, body: unknown): void {
  responses.delete(key);
  responses.set(key, { fingerprint, body, expires: Date.now() + RESPONSE_TTL_MS });
  if (responses.size > MAX_RESPONSES) responses.delete(responses.keys().next().value!);
}

export function recallResponse<T>(key: string, fingerprint: string): T | null {
  const hit = responses.get(key);
  if (!hit || hit.fingerprint !== fingerprint || hit.expires < Date.now()) return null;
  return hit.body as T;
}
