import "server-only";
import type { NextRequest } from "next/server";

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

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Returns true if the request is allowed. */
export function rateLimit(key: string, capacity: number, refillPerSecond: number): boolean {
  const now = Date.now();
  if (buckets.size > 20_000) buckets.clear();
  const bucket = buckets.get(key) ?? { tokens: capacity, updated: now };
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updated) / 1000) * refillPerSecond);
  bucket.updated = now;
  const allowed = bucket.tokens >= 1;
  if (allowed) bucket.tokens -= 1;
  buckets.set(key, bucket);
  return allowed;
}
