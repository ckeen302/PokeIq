import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Token-bucket rate limiter keyed by client IP. In-process, so limits are
 * per instance — enough to blunt scripted abuse of the grading and
 * leaderboard endpoints; swap the Map for Redis/Upstash for global limits.
 */

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20_000;
/** A bucket left alone this long has refilled for any limit in use. */
const IDLE_MS = 15 * 60_000;

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Makes room: drops buckets that have sat idle (they'd be full again anyway), or all of them as a last resort. */
function prune(now: number) {
  for (const [key, bucket] of buckets) if (now - bucket.updated > IDLE_MS) buckets.delete(key);
  if (buckets.size > MAX_BUCKETS) buckets.clear();
}

/** Returns true if the request is allowed. */
export function rateLimit(key: string, capacity: number, refillPerSecond: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) prune(now);
  const bucket = buckets.get(key) ?? { tokens: capacity, updated: now };
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updated) / 1000) * refillPerSecond);
  bucket.updated = now;
  const allowed = bucket.tokens >= 1;
  if (allowed) bucket.tokens -= 1;
  buckets.set(key, bucket);
  return allowed;
}

/** The 429 every endpoint sends: JSON with a message a player can read. */
export function tooManyRequests(error = "Slow down a little — try again in a moment.", retryAfterSeconds = 30): NextResponse {
  return NextResponse.json(
    { error },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } }
  );
}

/**
 * Chat messages, on top of the per-trainer limit each battle or duel keeps
 * (one a second, five in ten seconds): the same per trainer on this instance,
 * and per address. A friendly 429, or null to go ahead.
 */
export function chatRateLimit(ip: string, player: string): NextResponse | null {
  if (!rateLimit(`chat-player:${player}`, 5, 0.5)) return tooManyRequests("You're sending messages too fast. Wait a few seconds.", 5);
  if (!rateLimit(`chat-ip:${ip}`, 10, 1)) return tooManyRequests("Lots of messages from your network. Wait a few seconds.", 10);
  return null;
}
