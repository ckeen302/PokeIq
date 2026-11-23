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

/**
 * Claims seen on this instance, by expiry. Every claim lives MEMORY_TTL_MS, and
 * a key is deleted before it's set again, so the map stays in expiry order:
 * expired claims are dropped from the front as new ones arrive (a scan of the
 * whole map on every claim, as before, slowed each guess once it was large).
 */
const memory = new Map<string, number>();
const MEMORY_TTL_MS = 3 * 60 * 60 * 1000;
/**
 * With Postgres holding every claim, the local copy is only a shortcut, so it
 * keeps the newest of them. Without a database it is the only record and
 * keeps everything until it expires.
 */
export const MEMORY_CLAIMS_WITH_DATABASE = 200_000;

function claimInMemory(key: string, keep: number): boolean {
  const now = Date.now();
  for (const [k, exp] of memory) {
    if (exp > now && memory.size <= keep) break;
    memory.delete(k);
  }
  const existing = memory.get(key);
  if (existing && existing > now) return false;
  memory.delete(key);
  memory.set(key, now + MEMORY_TTL_MS);
  return true;
}

/** Tests: how many claims this instance holds. */
export const memoryClaims = () => memory.size;

export async function claimOnce(key: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  // Always check locally first: cheap, and catches same-instance replays.
  if (!claimInMemory(key, supabase ? MEMORY_CLAIMS_WITH_DATABASE : Infinity)) return false;
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

// ---------------------------------------------------------------------------
// Claims that know who made them
// ---------------------------------------------------------------------------

/*
 * A guess whose answer was lost (a network blip, a reload) is sent again,
 * maybe to another instance, which has no copy of the answer. So the claim
 * also records which request made it (its fingerprint, as a second key next
 * to the claim): the very same request is told it's a retry and answered
 * again, a different one (another pin on a round already guessed) is refused.
 */

const claimedBy = new Map<string, { fingerprint: string; expires: number }>();
const MAX_CLAIMED_BY = 20_000;
const byKey = (key: string, fingerprint: string) => `${key}#${fingerprint}`;

async function recordClaimant(key: string, fingerprint: string): Promise<void> {
  claimedBy.delete(key);
  claimedBy.set(key, { fingerprint, expires: Date.now() + MEMORY_TTL_MS });
  if (claimedBy.size > MAX_CLAIMED_BY) claimedBy.delete(claimedBy.keys().next().value!);
  const supabase = getServiceSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("token_claims").insert({ key: byKey(key, fingerprint) });
  if (error && error.code !== "23505") console.error("[replay-guard] claimant not recorded:", error.message);
}

async function madeBy(key: string, fingerprint: string): Promise<boolean> {
  const local = claimedBy.get(key);
  if (local && local.expires > Date.now()) return local.fingerprint === fingerprint;
  const supabase = getServiceSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase.from("token_claims").select("key").eq("key", byKey(key, fingerprint)).limit(1);
  if (error) {
    console.error("[replay-guard] claimant not read:", error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Claims `key` for one request: "new" the first time, "same" when the very
 * same request comes again (answer it again), "other" for a different one.
 */
export async function claimFor(key: string, fingerprint: string): Promise<"new" | "same" | "other"> {
  if (await claimOnce(key)) {
    await recordClaimant(key, fingerprint);
    return "new";
  }
  if (await madeBy(key, fingerprint)) return "same";
  // The first request may still be recording itself on another instance: one more look.
  await new Promise((r) => setTimeout(r, 300));
  return (await madeBy(key, fingerprint)) ? "same" : "other";
}
